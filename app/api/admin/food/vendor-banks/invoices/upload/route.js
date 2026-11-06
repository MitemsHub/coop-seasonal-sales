import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

async function resolveActiveCycleId(supabase) {
  const { data, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.id) return data.id
    // A closed season must not block this screen: fall back to the newest
    // cycle that actually has orders (lib/orderCycle does the same for lists).
    const { data: latestCycle } = await supabase
      .from('orders')
      .select('cycle_id')
      .not('cycle_id', 'is', null)
      .order('order_id', { ascending: false })
      .limit(1)
      .maybeSingle()
    return latestCycle?.cycle_id ?? null
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

function asInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

async function isPaidLocked(supabase, branchId, cycleId) {
  if (!cycleId) return false
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

export async function POST(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const cycleId = await resolveActiveCycleId(supabase)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const fd = await req.formData()
    const branchId = asInt(fd.get('branch_id') || fd.get('delivery_branch_id'), 0)
    if (!branchId) return NextResponse.json({ ok: false, error: 'branch_id required' }, { status: 400 })

    const locked = await isPaidLocked(supabase, branchId, cycleId).catch(() => false)
    if (locked) return NextResponse.json({ ok: false, error: 'Branch is marked as Paid. Editing is locked.' }, { status: 403 })

    // Every invoice belongs to one account, so the admin sees which account
    // the money went into and can pay that account on its own.
    const requestedBankId = Math.trunc(Number(fd.get('bank_account_id') || 0))
    if (!Number.isFinite(requestedBankId) || requestedBankId <= 0) {
      return NextResponse.json({ ok: false, error: 'Choose the bank account this invoice belongs to' }, { status: 400 })
    }
    const { data: acct, error: acctErr } = await supabase
      .from('food_vendor_bank_accounts')
      .select('id')
      .eq('id', requestedBankId)
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .maybeSingle()
    if (acctErr && !isMissingTable(acctErr, 'food_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: acctErr.message }, { status: 500 })
    }
    if (!acct?.id) return NextResponse.json({ ok: false, error: 'That bank account does not belong to this branch' }, { status: 400 })
    const bankAccountId = Number(acct.id)

    const file = fd.get('file')
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 })
    }

    const mime = String(file.type || '').toLowerCase()
    const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
    if (!allowedTypes.has(mime)) {
      return NextResponse.json({ ok: false, error: 'Only PDF/JPG/PNG/WEBP allowed' }, { status: 400 })
    }

    const invoiceRef = cleanText(fd.get('invoice_ref'), 120)
    const notes = cleanText(fd.get('notes'), 1000)

    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const rand = Math.random().toString(16).slice(2, 10)
    const bucket = 'vendor-invoices'
    const filename = safeName(file.name)
    const path = `food/admin/${branchId}/${cycleId}/${day}/${Date.now()}_${rand}_${filename}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buffer, { contentType: mime, upsert: false })
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    const createdByCode = cleanText(session?.claims?.email || session?.claims?.user || 'admin', 120) || 'admin'
    const { data: inserted, error: insErr } = await supabase
      .from('food_vendor_invoices')
      .insert({
        branch_id: branchId,
        cycle_id: cycleId,
        bank_account_id: bankAccountId,
        invoice_ref: invoiceRef || null,
        notes: notes || null,
        storage_bucket: bucket,
        storage_path: path,
        file_name: filename,
        mime_type: mime,
        file_size: buffer.length,
        created_by_role: 'admin',
        created_by_code: createdByCode,
      })
      .select('id,branch_id,cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .single()
    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 })

    const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
    return NextResponse.json({ ok: true, invoice: { ...inserted, url: urlData?.signedUrl || null } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

