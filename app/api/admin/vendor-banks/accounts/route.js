// app/api/admin/vendor-banks/accounts/route.js
// Admin management of the bank accounts attached to one payout owner.
//   GET    ?module=food|ram|exhibition&owner_id=NNN
//   POST   { module, owner_id, bank_name, account_name, account_number, purpose? }
//   PATCH  { module, owner_id, account_id, ...fields, purpose?, paid? }
//   DELETE ?module=...&owner_id=...&account_id=...
// Every account stands on its own: it has a purpose, the invoices filed against
// it, and a paid status. There is no primary account.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { resolveFoodCycle } from '@/lib/cycleResolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ACCOUNTS = 10

const MODULES = {
  food: {
    table: 'food_vendor_bank_accounts',
    invoiceTable: 'food_vendor_invoices',
    ownerCol: 'branch_id',
    cycleCol: 'cycle_id',
  },
  ram: {
    table: 'ram_vendor_bank_accounts',
    invoiceTable: 'ram_vendor_invoices',
    ownerCol: 'ram_delivery_location_id',
    cycleCol: 'ram_cycle_id',
  },
  exhibition: {
    table: 'exhibition_vendor_bank_accounts',
    invoiceTable: 'exhibition_vendor_invoices',
    ownerCol: 'vendor_id',
    cycleCol: 'cycle_id',
  },
}

const SELECT =
  'id,bank_name,account_name,account_number,purpose,is_paid,paid_at,paid_by,created_at,created_by_role,created_by_code'

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

function isMissingColumn(error, columnName) {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const c = String(columnName || '').toLowerCase()
  if (!msg.includes(c)) return false
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('could not find'))
}

async function hasColumn(supabase, tableName, columnName) {
  const { error } = await supabase.from(tableName).select(columnName).limit(1)
  if (!error) return true
  if (isMissingTable(error, tableName) || isMissingColumn(error, columnName)) return false
  throw error
}

function cleanText(v, maxLen = 120) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

function normalizeAccountNumber(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function parseId(v) {
  const n = Math.trunc(Number(v || 0))
  return Number.isFinite(n) && n > 0 ? n : 0
}

async function resolveRamCycleId(supabase) {
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
  const { data: latest, error: lErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (lErr) {
    if (isMissingTable(lErr, 'ram_cycles')) return null
    throw lErr
  }
  return latest?.id || null
}

async function loadContext(supabase, module, ownerId) {
  const meta = MODULES[module]
  if (!meta) return { error: 'Unknown module', status: 400 }

  let owner = null
  let cycleId = null
  let branchId = null
  let paidLock = false

  if (module === 'food') {
    const { data, error } = await supabase.from('branches').select('id,name,code').eq('id', ownerId).maybeSingle()
    if (error) throw error
    if (!data) return { error: 'Branch not found', status: 404 }
    owner = data
    const cycle = await resolveFoodCycle(supabase)
    cycleId = cycle?.id ? Number(cycle.id) : null
    const { data: paid } = await supabase
      .from('food_vendor_payment_status')
      .select('is_paid')
      .eq('branch_id', ownerId)
      .eq('cycle_id', cycleId)
      .maybeSingle()
    paidLock = !!paid?.is_paid
  } else if (module === 'ram') {
    const { data, error } = await supabase
      .from('ram_delivery_locations')
      .select('id,name,delivery_location')
      .eq('id', ownerId)
      .maybeSingle()
    if (error) throw error
    if (!data) return { error: 'Delivery location not found', status: 404 }
    owner = data
    cycleId = await resolveRamCycleId(supabase)
  } else {
    const { data, error } = await supabase
      .from('exhibition_vendors')
      .select('id,name,code,cycle_id,branch_id')
      .eq('id', ownerId)
      .maybeSingle()
    if (error) throw error
    if (!data) return { error: 'Vendor not found', status: 404 }
    owner = data
    cycleId = data.cycle_id ? Number(data.cycle_id) : null
    branchId = data.branch_id || null
  }

  const bankHasCycle = module === 'food' || module === 'exhibition'
    ? true
    : await hasColumn(supabase, meta.table, meta.cycleCol).catch(() => false)

  return { meta, owner, cycleId, branchId, bankHasCycle, paidLock }
}

function scoped(query, ctx, ownerId) {
  const { meta, cycleId, bankHasCycle } = ctx
  let q = query.eq(meta.ownerCol, ownerId)
  if (bankHasCycle && cycleId) q = q.eq(meta.cycleCol, cycleId)
  return q
}

async function listAccounts(supabase, ctx, ownerId) {
  let q = supabase.from(ctx.meta.table).select(SELECT)
  q = scoped(q, ctx, ownerId).order('created_at', { ascending: false })
  const { data, error } = await q
  if (error) {
    if (isMissingTable(error, ctx.meta.table)) return []
    throw error
  }
  return data || []
}

// The invoices filed against each account, with short-lived links so the admin
// can open the actual file. Older databases may not have the link column yet.
async function withInvoices(supabase, ctx, accounts) {
  if (!accounts.length) return accounts
  const table = ctx.meta.invoiceTable
  const linked = await hasColumn(supabase, table, 'bank_account_id').catch(() => false)
  if (!linked) return accounts.map((a) => ({ ...a, invoices: [], invoice_total: 0 }))

  const { data, error } = await supabase
    .from(table)
    .select('id,bank_account_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
    .in('bank_account_id', accounts.map((a) => a.id))
    .order('created_at', { ascending: false })
  if (error) return accounts.map((a) => ({ ...a, invoices: [], invoice_total: 0 }))

  const byAccount = new Map()
  for (const inv of data || []) {
    const key = Number(inv.bank_account_id)
    const list = byAccount.get(key) || []
    list.push(inv)
    byAccount.set(key, list)
  }

  return Promise.all(
    accounts.map(async (account) => {
      const rows = byAccount.get(Number(account.id)) || []
      const invoices = await Promise.all(
        rows.map(async (inv) => {
          const bucket = String(inv.storage_bucket || '')
          const path = String(inv.storage_path || '')
          let url = null
          if (bucket && path) {
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
            url = signed?.signedUrl || null
          }
          return { ...inv, url }
        })
      )
      const total = rows.reduce((sum, inv) => sum + Number(inv.amount || 0), 0)
      return { ...account, invoices, invoice_total: total }
    })
  )
}

async function respondWithAccounts(supabase, ctx, ownerId, extra = {}) {
  const accounts = await withInvoices(supabase, ctx, await listAccounts(supabase, ctx, ownerId))
  return NextResponse.json({ ok: true, accounts, cycle_id: ctx.cycleId, paid_lock: ctx.paidLock, ...extra })
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const module = String(searchParams.get('module') || '')
    const ownerId = parseId(searchParams.get('owner_id'))
    if (!MODULES[module]) return NextResponse.json({ ok: false, error: 'Unknown module' }, { status: 400 })
    if (!ownerId) return NextResponse.json({ ok: false, error: 'owner_id is required' }, { status: 400 })

    const supabase = createClient()
    const ctx = await loadContext(supabase, module, ownerId)
    if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status || 400 })

    return respondWithAccounts(supabase, ctx, ownerId, { module, owner_id: ownerId })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load bank accounts' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const module = String(body.module || '')
    const ownerId = parseId(body.owner_id)
    if (!MODULES[module]) return NextResponse.json({ ok: false, error: 'Unknown module' }, { status: 400 })
    if (!ownerId) return NextResponse.json({ ok: false, error: 'owner_id is required' }, { status: 400 })

    const bankName = cleanText(body.bank_name, 120)
    const accountName = cleanText(body.account_name, 120)
    const accountNumber = cleanText(body.account_number, 40)
    if (!bankName || !accountName || !accountNumber) {
      return NextResponse.json({ ok: false, error: 'Bank name, account name and account number are required' }, { status: 400 })
    }

    const supabase = createClient()
    const ctx = await loadContext(supabase, module, ownerId)
    if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status || 400 })
    if (ctx.paidLock) return NextResponse.json({ ok: false, error: 'Branch is marked as Paid. Editing is locked.' }, { status: 403 })

    const existing = await listAccounts(supabase, ctx, ownerId)
    if (existing.length >= MAX_ACCOUNTS) {
      return NextResponse.json({ ok: false, error: `Up to ${MAX_ACCOUNTS} bank accounts per vendor. Remove one first.` }, { status: 400 })
    }
    if (existing.some((a) => normalizeAccountNumber(a.account_number) === normalizeAccountNumber(accountNumber))) {
      return NextResponse.json({ ok: false, error: 'That account number is already attached.' }, { status: 409 })
    }

    const createdByCode = cleanText(session?.claims?.email || session?.claims?.user || 'admin', 120) || 'admin'
    const row = {
      [ctx.meta.ownerCol]: ownerId,
      bank_name: bankName,
      account_name: accountName,
      account_number: accountNumber,
      purpose: cleanText(body.purpose, 160) || null,
      is_current: false,
      created_by_role: 'admin',
      created_by_code: createdByCode,
    }
    if (ctx.bankHasCycle && ctx.cycleId) row[ctx.meta.cycleCol] = ctx.cycleId
    if (module === 'exhibition' && ctx.branchId) row.branch_id = ctx.branchId

    const { data, error } = await supabase.from(ctx.meta.table).insert(row).select(SELECT).single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return respondWithAccounts(supabase, ctx, ownerId, { account: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to add bank account' }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const module = String(body.module || '')
    const ownerId = parseId(body.owner_id)
    const accountId = parseId(body.account_id)
    if (!MODULES[module]) return NextResponse.json({ ok: false, error: 'Unknown module' }, { status: 400 })
    if (!ownerId || !accountId) return NextResponse.json({ ok: false, error: 'owner_id and account_id are required' }, { status: 400 })

    const supabase = createClient()
    const ctx = await loadContext(supabase, module, ownerId)
    if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status || 400 })

    const accounts = await listAccounts(supabase, ctx, ownerId)
    const row = accounts.find((a) => Number(a.id) === accountId)
    if (!row) return NextResponse.json({ ok: false, error: 'Bank account not found' }, { status: 404 })

    const patch = {}
    if (body.bank_name !== undefined) {
      const bankName = cleanText(body.bank_name, 120)
      if (!bankName) return NextResponse.json({ ok: false, error: 'Bank name is required' }, { status: 400 })
      patch.bank_name = bankName
    }
    if (body.account_name !== undefined) {
      const accountName = cleanText(body.account_name, 120)
      if (!accountName) return NextResponse.json({ ok: false, error: 'Account name is required' }, { status: 400 })
      patch.account_name = accountName
    }
    if (body.account_number !== undefined) {
      const accountNumber = cleanText(body.account_number, 40)
      if (!accountNumber) return NextResponse.json({ ok: false, error: 'Account number is required' }, { status: 400 })
      if (accounts.some((a) => Number(a.id) !== accountId && normalizeAccountNumber(a.account_number) === normalizeAccountNumber(accountNumber))) {
        return NextResponse.json({ ok: false, error: 'That account number is already attached.' }, { status: 409 })
      }
      patch.account_number = accountNumber
    }
    if (body.purpose !== undefined) patch.purpose = cleanText(body.purpose, 160) || null

    const wantsPaid = body.paid !== undefined
    const paid = body.paid === true || body.paid === 'true'
    const editingDetails = Object.keys(patch).length > 0
    if (editingDetails && row.is_paid && !(wantsPaid && !paid)) {
      return NextResponse.json({ ok: false, error: 'This account is marked as paid. Mark it unpaid before editing it.' }, { status: 403 })
    }
    if (wantsPaid) {
      patch.is_paid = paid
      patch.paid_at = paid ? new Date().toISOString() : null
      patch.paid_by = paid ? cleanText(session?.claims?.email || session?.claims?.user || 'admin', 120) || 'admin' : null
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    const { data, error } = await supabase
      .from(ctx.meta.table)
      .update(patch)
      .eq('id', accountId)
      .select(SELECT)
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return respondWithAccounts(supabase, ctx, ownerId, { account: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update bank account' }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const module = String(searchParams.get('module') || '')
    const ownerId = parseId(searchParams.get('owner_id'))
    const accountId = parseId(searchParams.get('account_id'))
    if (!MODULES[module]) return NextResponse.json({ ok: false, error: 'Unknown module' }, { status: 400 })
    if (!ownerId || !accountId) return NextResponse.json({ ok: false, error: 'owner_id and account_id are required' }, { status: 400 })

    const supabase = createClient()
    const ctx = await loadContext(supabase, module, ownerId)
    if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status || 400 })

    const accounts = await listAccounts(supabase, ctx, ownerId)
    const row = accounts.find((a) => Number(a.id) === accountId)
    if (!row) return NextResponse.json({ ok: false, error: 'Bank account not found' }, { status: 404 })
    if (row.is_paid) {
      return NextResponse.json({ ok: false, error: 'This account is marked as paid. Mark it unpaid before removing it.' }, { status: 403 })
    }

    const { error } = await supabase.from(ctx.meta.table).delete().eq('id', accountId)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return respondWithAccounts(supabase, ctx, ownerId, { deleted_id: accountId })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to remove bank account' }, { status: 500 })
  }
}
