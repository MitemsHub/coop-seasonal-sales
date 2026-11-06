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

async function resolveActiveRamCycleId(supabase) {
  const { data: active, error: aErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (aErr) {
    if (isMissingTable(aErr, 'ram_cycles')) return null
    throw aErr
  }
  if (active?.id) return active.id
  const { data: latest, error: lErr } = await supabase.from('ram_cycles').select('id').order('created_at', { ascending: false }).maybeSingle()
  if (lErr) {
    if (isMissingTable(lErr, 'ram_cycles')) return null
    throw lErr
  }
  return latest?.id || null
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

function getRepLocationIds(claims) {
  const rawIds = Array.isArray(claims?.ram_delivery_location_ids) ? claims.ram_delivery_location_ids : []
  const ids = rawIds.length ? rawIds : [claims?.ram_delivery_location_id]
  return ids.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0)
}

async function isPaidLocked(supabase, locationId, cycleId) {
  if (!cycleId) return false
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

export async function POST(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module !== 'ram') return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const fd = await req.formData()
    const locationId = Math.trunc(Number(fd.get('delivery_location_id') || fd.get('ram_delivery_location_id') || 0))
    if (!Number.isFinite(locationId) || locationId <= 0) {
      return NextResponse.json({ ok: false, error: 'delivery_location_id required' }, { status: 400 })
    }

    const allowed = new Set(getRepLocationIds(session.claims))
    if (!allowed.has(locationId)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

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

    const cycleId = await resolveActiveRamCycleId(supabase).catch(() => null)
    const locked = await isPaidLocked(supabase, locationId, cycleId).catch(() => false)
    if (locked) return NextResponse.json({ ok: false, error: 'Vendor is marked as Paid. Editing is locked.' }, { status: 403 })

    const requestedBankId = Math.trunc(Number(fd.get('bank_account_id') || 0))
    let bankAccountId = null
    if (requestedBankId > 0) {
      const { data: acct } = await supabase
        .from('ram_vendor_bank_accounts')
        .select('id')
        .eq('id', requestedBankId)
        .eq('ram_delivery_location_id', locationId)
        .maybeSingle()
      if (!acct?.id) return NextResponse.json({ ok: false, error: 'That bank account does not belong to this vendor' }, { status: 400 })
      bankAccountId = Number(acct.id)
    } else {
      const { data: latest } = await supabase
        .from('ram_vendor_bank_accounts')
        .select('id')
        .eq('ram_delivery_location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      bankAccountId = latest?.id ? Number(latest.id) : null
    }
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const rand = Math.random().toString(16).slice(2, 10)
    const bucket = 'vendor-invoices'
    const filename = safeName(file.name)
    const path = `ram/${locationId}/${day}/${Date.now()}_${rand}_${filename}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buffer, { contentType: mime, upsert: false })
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    const { data: inserted, error: insErr } = await supabase
      .from('ram_vendor_invoices')
      .insert({
        ram_delivery_location_id: locationId,
        ram_cycle_id: cycleId,
        bank_account_id: bankAccountId,
        invoice_ref: invoiceRef || null,
        notes: notes || null,
        storage_bucket: bucket,
        storage_path: path,
        file_name: filename,
        mime_type: mime,
        file_size: buffer.length,
        created_by_role: 'rep',
        created_by_code: String(session?.claims?.ram_vendor_code || '').trim() || null,
      })
      .select(
        'id,ram_delivery_location_id,ram_cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at'
      )
      .single()

    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 })

    const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
    return NextResponse.json({ ok: true, invoice: { ...inserted, url: urlData?.signedUrl || null } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
