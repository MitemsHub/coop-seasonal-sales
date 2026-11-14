// app/api/admin/exhibition/products/import/route.js
// Admin batch upload of products for one vendor: the admin picks the season and
// the stand, drops in the list, and every row gets a generated SKU. The vendor
// edits details/photos afterwards from their own portal.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { reserveSkus } from '@/lib/skuFormat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ROWS = 500

function toQty(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const cycleId = Math.trunc(Number(body?.cycle_id || 0))
    const vendorId = Math.trunc(Number(body?.vendor_id || 0))
    if (!Number.isFinite(cycleId) || cycleId <= 0) return NextResponse.json({ ok: false, error: 'Cycle is required' }, { status: 400 })
    if (!Number.isFinite(vendorId) || vendorId <= 0) return NextResponse.json({ ok: false, error: 'Vendor is required' }, { status: 400 })

    const rawRows = Array.isArray(body?.rows) ? body.rows : []
    const status = body?.status === 'draft' ? 'draft' : 'active'
    if (!rawRows.length) return NextResponse.json({ ok: false, error: 'No rows to import' }, { status: 400 })
    if (rawRows.length > MAX_ROWS) {
      return NextResponse.json({ ok: false, error: `Import at most ${MAX_ROWS} products at a time` }, { status: 400 })
    }

    const supabase = createClient()
    const { data: vendor, error: vendorError } = await supabase
      .from('exhibition_vendors')
      .select('id, code, branch_id')
      .eq('id', vendorId)
      .maybeSingle()
    if (vendorError) return NextResponse.json({ ok: false, error: vendorError.message }, { status: 500 })
    if (!vendor) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 404 })

    const failed = []
    const clean = []
    rawRows.forEach((row, index) => {
      const line = index + 1
      const name = String(row?.name || '').trim()
      if (!name) {
        failed.push({ row: line, error: 'Product name is missing' })
        return
      }
      const price = Math.trunc(Number(row?.price ?? row?.vendor_price ?? 0))
      if (!Number.isFinite(price) || price <= 0) {
        failed.push({ row: line, error: `"${name}" needs a price greater than zero` })
        return
      }
      clean.push({
        name: name.slice(0, 255),
        vendor_price: price,
        unit: String(row?.unit || 'each').trim().slice(0, 30) || 'each',
        qty: toQty(row?.qty),
      })
    })

    if (!clean.length) return NextResponse.json({ ok: true, created: [], failed })

    const { data: existing, error: skuError } = await supabase
      .from('exhibition_products')
      .select('sku')
      .eq('cycle_id', cycleId)
      .eq('vendor_id', vendorId)
    if (skuError) return NextResponse.json({ ok: false, error: skuError.message }, { status: 500 })

    const skus = reserveSkus({
      vendorCode: vendor.code,
      names: clean.map((r) => r.name),
      existingSkus: (existing || []).map((r) => r.sku),
    })

    const payload = clean.map((row, index) => ({
      cycle_id: cycleId,
      vendor_id: vendorId,
      branch_id: vendor.branch_id,
      name: row.name,
      sku: skus[index],
      unit: row.unit,
      vendor_price: row.vendor_price,
      qty: row.qty,
      status,
      approval_status: 'approved',
      approval_reviewed_at: new Date().toISOString(),
    }))

    const { data, error } = await supabase.from('exhibition_products').insert(payload).select('id, name, sku')
    if (!error) return NextResponse.json({ ok: true, created: data || [], failed })

    const created = []
    for (let i = 0; i < payload.length; i += 1) {
      const { data: one, error: rowError } = await supabase
        .from('exhibition_products')
        .insert(payload[i])
        .select('id, name, sku')
        .single()
      if (rowError) failed.push({ row: i + 1, error: rowError.message })
      else created.push(one)
    }
    return NextResponse.json({ ok: true, created, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to import products' }, { status: 500 })
  }
}
