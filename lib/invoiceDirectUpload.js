// Server side of the shared invoice upload path. A file above the request-body
// cap goes straight to Supabase Storage with a signed URL, so this module owns
// the one place that decides who may upload which invoice and how the row is
// recorded. Small files still take each module's existing upload route; these
// rules mirror those routes so the two paths cannot drift apart.
import { validateSession } from '@/lib/validation'
import { getVendorContext } from '@/app/api/vendor/_session'
import { resolveFoodCycleId } from '@/lib/cycleResolve'

const PDF_AND_PHOTOS = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const HEIC = ['image/heic', 'image/heif']

const FOOD_SELECT =
  'id,branch_id,cycle_id,bank_account_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at'
const RAM_SELECT =
  'id,ram_delivery_location_id,ram_cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at'
const EXHIBITION_SELECT =
  'id,vendor_id,cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at'

export const INVOICE_MODULES = ['food', 'ram', 'exhibition']

export function cleanText(v, maxLen = 500) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

export function safeName(name) {
  return String(name || 'file')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_')
    .slice(0, 120)
}

function intOf(v) {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

async function resolveActiveRamCycleId(supabase) {
  const { data: active, error } = await supabase
    .from('ram_cycles')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (error) {
    if (isMissingTable(error, 'ram_cycles')) return null
    throw error
  }
  if (active?.id) return active.id
  const { data: latest } = await supabase
    .from('ram_cycles')
    .select('id')
    .order('created_at', { ascending: false })
    .maybeSingle()
  return latest?.id || null
}

function repLocationIds(claims) {
  const raw = Array.isArray(claims?.ram_delivery_location_ids) ? claims.ram_delivery_location_ids : []
  const ids = raw.length ? raw : [claims?.ram_delivery_location_id]
  return ids.map((v) => intOf(v)).filter((n) => n > 0)
}

async function foodPaidLocked(supabase, branchId, cycleId) {
  const { data, error } = await supabase
    .from('food_vendor_payment_status')
    .select('is_paid')
    .eq('branch_id', branchId)
    .eq('cycle_id', cycleId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error, 'food_vendor_payment_status')) return false
    throw error
  }
  return !!data?.is_paid
}

async function ramPaidLocked(supabase, locationId, cycleId) {
  const { data, error } = await supabase
    .from('ram_vendor_payment_status')
    .select('is_paid')
    .eq('ram_delivery_location_id', locationId)
    .eq('ram_cycle_id', cycleId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error, 'ram_vendor_payment_status')) return false
    throw error
  }
  return !!data?.is_paid
}

async function exhibitionCycleForVendor(supabase, vendorId) {
  const { data: vendor } = await supabase
    .from('exhibition_vendors')
    .select('cycle_id')
    .eq('id', vendorId)
    .maybeSingle()
  if (vendor?.cycle_id) return Number(vendor.cycle_id)
  const { data, error } = await supabase
    .from('exhibition_cycles')
    .select('id')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (error) return null
  return data?.id ? Number(data.id) : null
}

// Who is uploading: an admin, a module rep, or the vendor themself. The role
// decides which modules and which owner they may touch.
export async function authenticateInvoiceActor(req, module) {
  if (!INVOICE_MODULES.includes(module)) return { error: 'Unknown invoice module', status: 400 }

  const session = await validateSession(req)
  // tokenType names the cookie that verified, which is the authoritative role;
  // the claim is the fallback for older tokens.
  const role = session.valid ? String(session.tokenType || session.claims?.role || '') : ''

  if (role === 'admin') return { role: 'admin', claims: session.claims }

  if (role === 'rep') {
    if (module === 'exhibition') return { error: 'Unauthorized', status: 401 }
    const repModule = String(session.claims?.module || '')
    if (repModule && repModule !== module) return { error: 'Unauthorized', status: 401 }
    return { role: 'rep', claims: session.claims }
  }

  if (role === 'vendor' && module === 'exhibition') {
    const vendor = await getVendorContext(req)
    if (!vendor) return { error: 'Unauthorized', status: 401 }
    return { role: 'vendor', vendor }
  }

  return { error: 'Unauthorized', status: 401 }
}

async function resolveFoodTarget(supabase, actor, body) {
  const isAdmin = actor.role === 'admin'
  const branchId = isAdmin ? intOf(body?.branch_id || body?.delivery_branch_id) : intOf(actor.claims?.branch_id)
  if (!branchId) return { error: isAdmin ? 'branch_id required' : 'Forbidden', status: isAdmin ? 400 : 403 }

  const cycleId = await resolveFoodCycleId(supabase)
  if (!cycleId) return { error: 'No active cycle found', status: 400 }

  if (await foodPaidLocked(supabase, branchId, cycleId)) {
    return { error: 'Branch is marked as Paid. Editing is locked.', status: 403 }
  }

  const requested = intOf(body?.bank_account_id)
  let acct = null
  if (requested) {
    const { data, error } = await supabase
      .from('food_vendor_bank_accounts')
      .select('id,is_paid')
      .eq('id', requested)
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .maybeSingle()
    if (error && !isMissingTable(error, 'food_vendor_bank_accounts')) throw error
    if (!data?.id) return { error: 'That bank account does not belong to this branch', status: 400 }
    acct = data
  } else {
    const { data } = await supabase
      .from('food_vendor_bank_accounts')
      .select('id,is_paid')
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .eq('is_current', true)
      .maybeSingle()
    acct = data
  }
  if (!acct?.id) return { error: 'Choose the bank account this invoice belongs to.', status: 400 }
  if (acct.is_paid) {
    return { error: 'This bank account is marked as Paid. Editing is locked.', status: 403 }
  }

  return {
    module: 'food',
    table: 'food_vendor_invoices',
    select: FOOD_SELECT,
    urlKind: 'food',
    pathPrefix: `food/${branchId}/${cycleId}`,
    row: { branch_id: branchId, cycle_id: cycleId, bank_account_id: Number(acct.id) },
    allowedMime: new Set(isAdmin ? PDF_AND_PHOTOS : [...PDF_AND_PHOTOS, ...HEIC]),
    createdByRole: isAdmin ? 'admin' : 'rep',
    createdByCode: isAdmin
      ? cleanText(actor.claims?.email || actor.claims?.user || 'admin', 120) || 'admin'
      : cleanText(actor.claims?.branch_code || actor.claims?.rep_code || '', 120) || null,
  }
}

async function resolveRamTarget(supabase, actor, body) {
  const isAdmin = actor.role === 'admin'
  const locationId = intOf(body?.delivery_location_id || body?.ram_delivery_location_id)
  if (!locationId) return { error: 'delivery_location_id required', status: 400 }
  if (!isAdmin && !repLocationIds(actor.claims).includes(locationId)) {
    return { error: 'Forbidden', status: 403 }
  }

  const requestedCycle = intOf(body?.cycle_id || body?.ram_cycle_id)
  const cycleId =
    isAdmin && requestedCycle ? requestedCycle : await resolveActiveRamCycleId(supabase).catch(() => null)

  if (!isAdmin && (await ramPaidLocked(supabase, locationId, cycleId).catch(() => false))) {
    return { error: 'Vendor is marked as Paid. Editing is locked.', status: 403 }
  }

  const requested = intOf(body?.bank_account_id)
  let bankAccountId = null
  if (requested) {
    const { data } = await supabase
      .from('ram_vendor_bank_accounts')
      .select('id')
      .eq('id', requested)
      .eq('ram_delivery_location_id', locationId)
      .maybeSingle()
    if (!data?.id) return { error: 'That bank account does not belong to this vendor', status: 400 }
    bankAccountId = Number(data.id)
  } else {
    const { data } = await supabase
      .from('ram_vendor_bank_accounts')
      .select('id')
      .eq('ram_delivery_location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    bankAccountId = data?.id ? Number(data.id) : null
  }

  return {
    module: 'ram',
    table: 'ram_vendor_invoices',
    select: RAM_SELECT,
    urlKind: 'ram',
    pathPrefix: `ram/${locationId}`,
    row: { ram_delivery_location_id: locationId, ram_cycle_id: cycleId, bank_account_id: bankAccountId },
    allowedMime: new Set(PDF_AND_PHOTOS),
    createdByRole: isAdmin ? 'admin' : 'rep',
    createdByCode: isAdmin
      ? null
      : cleanText(actor.claims?.ram_vendor_code || '', 120) || null,
  }
}

async function resolveExhibitionTarget(supabase, actor, body) {
  const isAdmin = actor.role === 'admin'
  const vendorId = isAdmin ? intOf(body?.vendor_id) : intOf(actor.vendor?.vendor_id)
  if (!vendorId) return { error: isAdmin ? 'vendor_id required' : 'Unauthorized', status: isAdmin ? 400 : 401 }

  const requestedCycle = intOf(body?.cycle_id)
  const cycleId = isAdmin
    ? requestedCycle || (await exhibitionCycleForVendor(supabase, vendorId))
    : actor.vendor?.cycle_id || null

  // Vendors cannot pick an account on this route today, so their direct
  // uploads file without one, exactly as the small-file route does.
  let bankAccountId = null
  if (isAdmin) {
    const requested = intOf(body?.bank_account_id)
    if (requested) {
      const { data } = await supabase
        .from('exhibition_vendor_bank_accounts')
        .select('id')
        .eq('id', requested)
        .eq('vendor_id', vendorId)
        .maybeSingle()
      if (!data?.id) return { error: 'That bank account does not belong to this vendor', status: 400 }
      bankAccountId = Number(data.id)
    } else {
      const { data } = await supabase
        .from('exhibition_vendor_bank_accounts')
        .select('id')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      bankAccountId = data?.id ? Number(data.id) : null
    }
  }

  return {
    module: 'exhibition',
    table: 'exhibition_vendor_invoices',
    select: EXHIBITION_SELECT,
    urlKind: 'exhibition',
    pathPrefix: `exhibition/${vendorId}`,
    row: { vendor_id: vendorId, cycle_id: cycleId, bank_account_id: bankAccountId },
    allowedMime: new Set(isAdmin ? PDF_AND_PHOTOS : [...PDF_AND_PHOTOS, ...HEIC]),
    createdByRole: isAdmin ? 'admin' : 'vendor',
    createdByCode: isAdmin
      ? null
      : cleanText(actor.vendor?.vendor_code || '', 120) || 'vendor',
    withDetails: true,
  }
}

// Resolves the row every direct upload will create, or the reason it may not.
export async function resolveInvoiceTarget(supabase, module, actor, body) {
  if (module === 'food') return resolveFoodTarget(supabase, actor, body)
  if (module === 'ram') return resolveRamTarget(supabase, actor, body)
  if (module === 'exhibition') return resolveExhibitionTarget(supabase, actor, body)
  return { error: 'Unknown invoice module', status: 400 }
}

export function buildInvoiceRow(target, { path, fileName, mime, fileSize, body }) {
  const row = {
    ...target.row,
    invoice_ref: cleanText(body?.invoice_ref, 120) || null,
    notes: cleanText(body?.notes, 1000) || null,
    storage_bucket: 'vendor-invoices',
    storage_path: path,
    file_name: fileName,
    mime_type: mime,
    file_size: fileSize,
    created_by_role: target.createdByRole,
    created_by_code: target.createdByCode,
  }
  if (target.withDetails) {
    const amount = Number(body?.amount)
    row.amount = Number.isFinite(amount) && amount > 0 ? amount : null
    row.invoice_date = String(body?.invoice_date || '').slice(0, 10) || null
  }
  return row
}