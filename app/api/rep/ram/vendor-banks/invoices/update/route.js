import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { invoiceFileLink } from '@/lib/invoiceStorage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
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

function getRepLocationIds(claims) {
  const rawIds = Array.isArray(claims?.ram_delivery_location_ids) ? claims.ram_delivery_location_ids : []
  const ids = rawIds.length ? rawIds : [claims?.ram_delivery_location_id]
  return ids.map((v) => asInt(v, null)).filter((n) => Number.isFinite(n) && n > 0)
}

function cleanText(v, maxLen = 500) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

function cleanDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

function cleanAmount(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return n
}

export async function POST(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module !== 'ram') return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const invoiceId = Math.trunc(Number(body?.invoice_id || body?.id || 0))
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) return NextResponse.json({ ok: false, error: 'invoice_id required' }, { status: 400 })

    const payload = {}
    if (body?.invoice_ref !== undefined) payload.invoice_ref = cleanText(body.invoice_ref, 120) || null
    if (body?.notes !== undefined) payload.notes = cleanText(body.notes, 1000) || null
    if (body?.invoice_date !== undefined) payload.invoice_date = cleanDate(body.invoice_date)
    if (body?.amount !== undefined) payload.amount = cleanAmount(body.amount)

    if (!Object.keys(payload).length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    const allowed = new Set(getRepLocationIds(session.claims))
    const supabase = createClient()

    const { data: inv, error: selErr } = await supabase
      .from('ram_vendor_invoices')
      .select('id,ram_delivery_location_id,ram_cycle_id,storage_bucket,storage_path')
      .eq('id', invoiceId)
      .maybeSingle()

    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })
    if (!inv) return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 })

    const locationId = Number(inv.ram_delivery_location_id)
    if (!allowed.has(locationId)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

    const cycleId = inv.ram_cycle_id ?? (await resolveActiveRamCycleId(supabase).catch(() => null))
    const locked = await isPaidLocked(supabase, locationId, cycleId).catch(() => false)
    if (locked) return NextResponse.json({ ok: false, error: 'Vendor is marked as Paid. Editing is locked.' }, { status: 403 })

    const { data: updated, error } = await supabase
      .from('ram_vendor_invoices')
      .update(payload)
      .eq('id', invoiceId)
      .select(
        'id,ram_delivery_location_id,ram_cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at'
      )
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, invoice: { ...updated, url: invoiceFileLink('ram', updated) } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}

