// app/api/vendor/exhibition/products/import/route.js
// Batch upload for a vendor's own stand: the CSV rows arrive already parsed by
// the browser, we validate them, generate SKUs and create the products in one
// pass. Anything invalid comes back per row instead of failing the batch.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'
import { reserveSkus } from '@/lib/skuFormat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ROWS = 500

function toQty(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!ctx.cycle_id) return NextResponse.json({ error: 'No active exhibition cycle for this vendor' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const rawRows = Array.isArray(body?.rows) ? body.rows : []
    if (!rawRows.length) return NextResponse.json({ error: 'No rows to import' }, { status: 400 })
    if (rawRows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Import at most ${MAX_ROWS} products at a time` }, { status: 400 })
    }

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

    const supabase = createClient()
    const { data: existing, error: skuError } = await supabase
      .from('exhibition_products')
      .select('sku')
      .eq('cycle_id', ctx.cycle_id)
      .eq('vendor_id', ctx.vendor_id)
    if (skuError) return NextResponse.json({ error: skuError.message || 'Failed to read existing SKUs' }, { status: 500 })

    const skus = reserveSkus({
      vendorCode: ctx.vendor_code,
      names: clean.map((r) => r.name),
      existingSkus: (existing || []).map((r) => r.sku),
    })

    const payload = clean.map((row, index) => ({
      cycle_id: ctx.cycle_id,
      vendor_id: ctx.vendor_id,
      branch_id: ctx.branch_id,
      name: row.name,
      sku: skus[index],
      unit: row.unit,
      vendor_price: row.vendor_price,
      qty: row.qty,
      status: 'draft',
      approval_status: 'pending',
      approval_requested_at: new Date().toISOString(),
    }))

    const { data, error } = await supabase.from('exhibition_products').insert(payload).select('id, name, sku')
    if (!error) return NextResponse.json({ ok: true, created: data || [], failed })

    // One bad row should not throw away the rest of the list — retry singly so
    // the import reports exactly which lines failed and why.
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
    return NextResponse.json({ error: e.message || 'Failed to import products' }, { status: 500 })
  }
}
