import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { invoiceFileUrl } from '@/lib/invoiceStorage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const invoiceId = Math.trunc(Number(body?.invoice_id || body?.id || 0))
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) return NextResponse.json({ ok: false, error: 'invoice_id required' }, { status: 400 })

    const payload = {}
    if (body?.invoice_ref !== undefined) payload.invoice_ref = cleanText(body.invoice_ref, 120) || null
    if (body?.notes !== undefined) payload.notes = cleanText(body.notes, 1000) || null
    if (body?.invoice_date !== undefined) payload.invoice_date = cleanDate(body.invoice_date)
    if (body?.amount !== undefined) payload.amount = cleanAmount(body.amount)

    if (!Object.keys(payload).length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    const supabase = createClient()
    const { data: updated, error } = await supabase
      .from('exhibition_vendor_invoices')
      .update(payload)
      .eq('id', invoiceId)
      .select('id,vendor_id,cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const url = await invoiceFileUrl(supabase, updated)
    return NextResponse.json({ ok: true, invoice: { ...updated, url } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
