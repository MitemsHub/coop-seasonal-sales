// app/api/vendor/exhibition/invoices/route.js
// The vendor's OWN payout invoices, tied to their exhibition season (cycle).
//   GET    — list this vendor's invoices (signed/local download URLs)
//   POST   — upload a new invoice (PDF/JPG/PNG/WEBP) for their cycle
//   DELETE — remove one of their invoices (query: invoice_id)
// The co-op's admin/rep sides read the same exhibition_vendor_invoices table.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../_session'
import { uploadInvoiceFile, invoiceFileUrl, removeInvoiceFile } from '@/lib/invoiceStorage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
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

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const cycleIdRaw = asInt(searchParams.get('cycle_id'), null)

    const supabase = createClient()
    const cycleId = Number.isFinite(cycleIdRaw) && cycleIdRaw != null && cycleIdRaw > 0
      ? cycleIdRaw
      : ctx.cycle_id

    let q = supabase
      .from('exhibition_vendor_invoices')
      .select('id,vendor_id,cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .eq('vendor_id', ctx.vendor_id)
      .order('created_at', { ascending: false })
      .limit(200)
    if (cycleId) q = q.eq('cycle_id', cycleId)
    const { data: rows, error } = await q
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const withUrl = await Promise.all(
      (rows || []).map(async (r) => ({ ...r, url: await invoiceFileUrl(supabase, r) }))
    )

    return NextResponse.json({ ok: true, invoices: withUrl, cycle_id: cycleId })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load invoices' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const fd = await req.formData()

    const file = fd.get('file')
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 })
    }

    const mime = String(file.type || '').toLowerCase()
    const allowed = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
    if (!allowed.has(mime)) {
      return NextResponse.json({ ok: false, error: 'Only PDF/JPG/PNG/WEBP allowed' }, { status: 400 })
    }

    const invoiceRef = cleanText(fd.get('invoice_ref'), 120)
    const notes = cleanText(fd.get('notes'), 1000)
    const amountRaw = Number(fd.get('amount'))
    const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null
    const invoiceDate = String(fd.get('invoice_date') || '').slice(0, 10) || null

    const cycleId = ctx.cycle_id
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const rand = Math.random().toString(16).slice(2, 10)
    const filename = safeName(file.name)
    const path = `exhibition/${ctx.vendor_id}/${day}/${Date.now()}_${rand}_${filename}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const stored = await uploadInvoiceFile(supabase, {
      path,
      publicPrefix: `invoices/${ctx.vendor_id}`,
      buffer,
      mime,
    })

    const { data: inserted, error: insErr } = await supabase
      .from('exhibition_vendor_invoices')
      .insert({
        vendor_id: ctx.vendor_id,
        cycle_id: cycleId,
        invoice_ref: invoiceRef || null,
        invoice_date: invoiceDate,
        amount,
        notes: notes || null,
        storage_bucket: stored.storage_bucket,
        storage_path: stored.storage_path,
        file_name: filename,
        mime_type: mime,
        file_size: buffer.length,
        created_by_role: 'vendor',
        created_by_code: String(ctx.vendor_code || '').slice(0, 120) || 'vendor',
      })
      .select('id,vendor_id,cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .single()
    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, invoice: { ...inserted, url: stored.url } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to upload invoice' }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const invoiceId = asInt(searchParams.get('invoice_id') || searchParams.get('id'), 0)
    if (!invoiceId) return NextResponse.json({ ok: false, error: 'invoice_id required' }, { status: 400 })

    const supabase = createClient()
    const { data: inv, error: selErr } = await supabase
      .from('exhibition_vendor_invoices')
      .select('id,storage_bucket,storage_path,vendor_id')
      .eq('id', invoiceId)
      .maybeSingle()
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })
    if (!inv) return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 })
    // Vendors can only delete their own invoices.
    if (Number(inv.vendor_id) !== Number(ctx.vendor_id)) {
      return NextResponse.json({ ok: false, error: 'Not your invoice' }, { status: 403 })
    }

    await removeInvoiceFile(supabase, inv)

    const { error: delErr } = await supabase.from('exhibition_vendor_invoices').delete().eq('id', invoiceId)
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to delete invoice' }, { status: 500 })
  }
}
