import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { resolveFoodCycleId } from '@/lib/cycleResolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'vendor-invoices'
const MAX_INVOICE_BYTES = 10 * 1024 * 1024
const EXT_TO_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}
const ALLOWED_TYPES = new Set(Object.values(EXT_TO_MIME))

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

function cleanText(v, maxLen = 500) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

function safeName(name) {
  return String(name || 'file')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_')
    .slice(0, 120)
}

function resolveInvoiceMime(fileName, declaredType) {
  const name = String(fileName || '')
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext]
  const declared = String(declaredType || '').toLowerCase()
  if (!declared || declared === 'application/octet-stream') return ''
  return declared
}

async function isPaidLocked(supabase, branchId, cycleId) {
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

async function resolveBankAccount(supabase, branchId, cycleId, requestedBankId) {
  const requested = Math.trunc(Number(requestedBankId || 0))
  if (Number.isFinite(requested) && requested > 0) {
    const { data: acct, error } = await supabase
      .from('food_vendor_bank_accounts')
      .select('id,is_paid')
      .eq('id', requested)
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .maybeSingle()
    if (error && !isMissingTable(error, 'food_vendor_bank_accounts')) throw error
    if (!acct?.id) return { error: 'That bank account does not belong to this branch' }
    return { bankAccountId: Number(acct.id), isPaid: !!acct.is_paid }
  }

  const { data: current } = await supabase
    .from('food_vendor_bank_accounts')
    .select('id,is_paid')
    .eq('branch_id', branchId)
    .eq('cycle_id', cycleId)
    .eq('is_current', true)
    .maybeSingle()
  return { bankAccountId: current?.id ? Number(current.id) : null, isPaid: !!current?.is_paid }
}

export async function POST(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module && session.claims.module !== 'food') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const branchId = Number(session?.claims?.branch_id)
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createClient()
    const cycleId = await resolveFoodCycleId(supabase)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    if (await isPaidLocked(supabase, branchId, cycleId).catch(() => false)) {
      return NextResponse.json({ ok: false, error: 'Branch is marked as Paid. Editing is locked.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '').trim()
    const account = await resolveBankAccount(supabase, branchId, cycleId, body?.bank_account_id)
    if (account.error) return NextResponse.json({ ok: false, error: account.error }, { status: 400 })
    if (account.isPaid) {
      return NextResponse.json(
        { ok: false, error: 'This bank account is marked as Paid. Editing is locked.' },
        { status: 403 }
      )
    }

    if (action === 'sign') {
      const fileName = safeName(body?.file_name)
      const mime = resolveInvoiceMime(fileName, body?.file_type)
      if (!ALLOWED_TYPES.has(mime)) {
        return NextResponse.json(
          { ok: false, error: 'Attach the invoice as a PDF or a photo (JPG, PNG, WEBP or HEIC).' },
          { status: 400 }
        )
      }

      const fileSize = Number(body?.file_size || 0)
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_INVOICE_BYTES) {
        return NextResponse.json(
          { ok: false, error: 'That file is larger than 10MB — take a smaller photo or send the PDF again.' },
          { status: 400 }
        )
      }

      const now = new Date()
      const day = now.toISOString().slice(0, 10)
      const rand = Math.random().toString(16).slice(2, 10)
      const path = `food/${branchId}/${cycleId}/${day}/${Date.now()}_${rand}_${fileName}`
      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(path, { upsert: false })
      if (signErr) {
        return NextResponse.json({ ok: false, error: signErr.message || 'Could not prepare the upload' }, { status: 500 })
      }

      return NextResponse.json({
        ok: true,
        action: 'sign',
        bucket: BUCKET,
        path: signed?.path || path,
        token: signed?.token,
        signed_url: signed?.signedUrl || null,
        file_name: fileName,
        mime_type: mime,
        file_size: fileSize,
        bank_account_id: account.bankAccountId,
      })
    }

    if (action === 'complete') {
      const path = String(body?.path || '')
      const prefix = `food/${branchId}/${cycleId}/`
      if (!path.startsWith(prefix) || path.includes('..') || path.includes('\\')) {
        return NextResponse.json({ ok: false, error: 'Invalid upload path' }, { status: 400 })
      }

      const slash = path.lastIndexOf('/')
      const dir = slash >= 0 ? path.slice(0, slash) : ''
      const storedName = slash >= 0 ? path.slice(slash + 1) : ''
      if (!dir || !storedName) return NextResponse.json({ ok: false, error: 'Invalid upload path' }, { status: 400 })

      const fileName = safeName(body?.file_name || storedName)
      const mime = resolveInvoiceMime(storedName, body?.mime_type)
      if (!ALLOWED_TYPES.has(mime)) {
        return NextResponse.json(
          { ok: false, error: 'Attach the invoice as a PDF or a photo (JPG, PNG, WEBP or HEIC).' },
          { status: 400 }
        )
      }

      const { data: listed, error: listErr } = await supabase.storage.from(BUCKET).list(dir, {
        search: storedName,
        limit: 1,
      })
      if (listErr) {
        return NextResponse.json({ ok: false, error: listErr.message || 'Could not verify the uploaded file' }, { status: 500 })
      }
      const object = Array.isArray(listed) ? listed.find((f) => f.name === storedName) : null
      if (!object) {
        return NextResponse.json(
          { ok: false, error: 'The file did not finish uploading. Please try again.' },
          { status: 400 }
        )
      }

      const reportedSize = Number(body?.file_size || 0)
      const actualSize = Number(object?.metadata?.size ?? reportedSize)
      const fileSize = Number.isFinite(actualSize) && actualSize > 0 ? actualSize : reportedSize
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_INVOICE_BYTES) {
        await supabase.storage.from(BUCKET).remove([path])
        return NextResponse.json(
          { ok: false, error: 'That file is larger than 10MB — take a smaller photo or send the PDF again.' },
          { status: 400 }
        )
      }

      const createdByCode =
        cleanText(session?.claims?.branch_code || session?.claims?.rep_code || '', 120) || null
      const { data: inserted, error: insErr } = await supabase
        .from('food_vendor_invoices')
        .insert({
          branch_id: branchId,
          cycle_id: cycleId,
          bank_account_id: account.bankAccountId,
          invoice_ref: cleanText(body?.invoice_ref, 120) || null,
          notes: cleanText(body?.notes, 1000) || null,
          storage_bucket: BUCKET,
          storage_path: path,
          file_name: fileName,
          mime_type: mime,
          file_size: fileSize,
          created_by_role: 'rep',
          created_by_code: createdByCode,
        })
        .select(
          'id,branch_id,cycle_id,bank_account_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at'
        )
        .single()
      if (insErr) {
        await supabase.storage.from(BUCKET).remove([path])
        return NextResponse.json({ ok: false, error: `Could not save the invoice: ${insErr.message}` }, { status: 500 })
      }

      const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
      return NextResponse.json({ ok: true, action: 'complete', invoice: { ...inserted, url: urlData?.signedUrl || null } })
    }

    return NextResponse.json({ ok: false, error: 'Unknown upload action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
