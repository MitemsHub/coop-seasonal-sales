import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { uploadInvoiceFile } from '@/lib/invoiceStorage'

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

async function resolveCycleId(supabase, vendorId) {
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
  if (error) {
    if (isMissingTable(error, 'exhibition_cycles')) return null
    return null
  }
  return data?.id ? Number(data.id) : null
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

export async function POST(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const fd = await req.formData()
    const vendorId = Math.trunc(Number(fd.get('vendor_id') || 0))
    if (!Number.isFinite(vendorId) || vendorId <= 0) {
      return NextResponse.json({ ok: false, error: 'vendor_id required' }, { status: 400 })
    }

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

    const cycleIdRaw = Math.trunc(Number(fd.get('cycle_id') || 0))
    const cycleId = Number.isFinite(cycleIdRaw) && cycleIdRaw > 0 ? cycleIdRaw : await resolveCycleId(supabase, vendorId).catch(() => null)
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const rand = Math.random().toString(16).slice(2, 10)
    const bucket = 'vendor-invoices'
    const filename = safeName(file.name)
    const path = `exhibition/${vendorId}/${day}/${Date.now()}_${rand}_${filename}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const stored = await uploadInvoiceFile(supabase, {
      path,
      publicPrefix: `invoices/${vendorId}`,
      buffer,
      mime,
    })

    const { data: inserted, error: insErr } = await supabase
      .from('exhibition_vendor_invoices')
      .insert({
        vendor_id: vendorId,
        cycle_id: cycleId,
        invoice_ref: invoiceRef || null,
        notes: notes || null,
        storage_bucket: stored.storage_bucket,
        storage_path: stored.storage_path,
        file_name: filename,
        mime_type: mime,
        file_size: buffer.length,
        created_by_role: 'admin',
        created_by_code: null,
      })
      .select('id,vendor_id,cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .single()

    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, invoice: { ...inserted, url: stored.url } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
