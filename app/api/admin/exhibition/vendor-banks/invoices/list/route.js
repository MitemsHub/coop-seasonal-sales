import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { invoiceFileUrl } from '@/lib/invoiceStorage'

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

async function resolveActiveExhibitionCycleId(supabase, vendorId) {
  // Prefer the vendor's own cycle, then any active cycle.
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

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const vendorId = asInt(searchParams.get('vendor_id'), 0)
    if (!vendorId) return NextResponse.json({ ok: false, error: 'vendor_id required' }, { status: 400 })
    const cycleIdRaw = asInt(searchParams.get('cycle_id'), null)

    const supabase = createClient()
    const cycleId = Number.isFinite(cycleIdRaw) && cycleIdRaw != null && cycleIdRaw > 0
      ? cycleIdRaw
      : await resolveActiveExhibitionCycleId(supabase, vendorId).catch(() => null)
    let q = supabase
      .from('exhibition_vendor_invoices')
      .select('id,vendor_id,cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (cycleId) q = q.eq('cycle_id', cycleId)
    const { data: rows, error } = await q

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const withUrl = await Promise.all(
      (rows || []).map(async (r) => ({ ...r, url: await invoiceFileUrl(supabase, r) }))
    )

    return NextResponse.json({ ok: true, invoices: withUrl })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
