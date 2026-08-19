// app/api/admin/exhibition/products/route.js
// Admin oversight of exhibition products.
//   GET  — list products (filters: cycle_id, vendor_id, status, q)
//   POST — create a product on behalf of a vendor
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    const vendorId = Math.trunc(Number(searchParams.get('vendor_id') || 0))
    const status = String(searchParams.get('status') || '')
    const q = String(searchParams.get('q') || '').trim()

    const supabase = createClient()
    let query = supabase
      .from('exhibition_products')
      .select('id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, admin_markup, qty, image_url, status, created_at, vendors:vendor_id(name, code), categories:category_id(name), branches:branch_id(name)')
      .order('created_at', { ascending: false })

    if (cycleId > 0) query = query.eq('cycle_id', cycleId)
    if (vendorId > 0) query = query.eq('vendor_id', vendorId)
    if (status && status !== 'all') query = query.eq('status', status)
    if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)

    const { data, error } = await query
    if (error) {
      if (isMissingTable(error, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet. Run migrations/add-coop-exhibition-module.sql in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      products: (data || []).map((p) => ({
        ...p,
        vendor_name: p.vendors?.name || '',
        category_name: p.categories?.name || '',
        branch_name: p.branches?.name || '',
        final_price: Number(p.vendor_price || 0) + Number(p.admin_markup || 0),
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load products' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const cycleId = Math.trunc(Number(body.cycle_id || 0))
    const vendorId = Math.trunc(Number(body.vendor_id || 0))
    const branchId = Math.trunc(Number(body.branch_id || 0))
    if (!Number.isFinite(cycleId) || cycleId <= 0) return NextResponse.json({ ok: false, error: 'Cycle is required' }, { status: 400 })
    if (!Number.isFinite(vendorId) || vendorId <= 0) return NextResponse.json({ ok: false, error: 'Vendor is required' }, { status: 400 })
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Branch is required' }, { status: 400 })

    const name = sanitizeString(body.name || '', { maxLength: 255, encodeHtml: false })
    if (!name) return NextResponse.json({ ok: false, error: 'Product name is required' }, { status: 400 })
    const sku = sanitizeString(body.sku || '', { maxLength: 60, encodeHtml: false }).toUpperCase()
    if (!sku) return NextResponse.json({ ok: false, error: 'SKU is required' }, { status: 400 })

    const vendorPrice = Math.max(0, Math.trunc(Number(body.vendor_price || 0)))
    if (vendorPrice <= 0) return NextResponse.json({ ok: false, error: 'Price must be greater than zero' }, { status: 400 })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_products')
      .insert({
        cycle_id: cycleId,
        vendor_id: vendorId,
        branch_id: branchId,
        category_id: body.category_id ? Math.trunc(Number(body.category_id)) : null,
        name,
        sku,
        unit: sanitizeString(body.unit || 'each', { maxLength: 30, encodeHtml: false }),
        vendor_price: vendorPrice,
        admin_markup: Math.max(0, Math.trunc(Number(body.admin_markup || 0))),
        qty: body.qty === '' || body.qty === null || body.qty === undefined ? null : Math.max(0, Math.trunc(Number(body.qty))),
        image_url: sanitizeString(body.image_url || '', { maxLength: 500, encodeHtml: false }),
        status: body.status === 'draft' ? 'draft' : 'active',
      })
      .select('id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, admin_markup, qty, image_url, status, created_at')
      .single()
    if (error) {
      if (String(error.code || '') === '23505') {
        return NextResponse.json({ ok: false, error: `SKU "${sku}" already exists. Use a unique SKU.` }, { status: 409 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, product: { ...data, final_price: vendorPrice + Number(data.admin_markup || 0) } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to create product' }, { status: 500 })
  }
}
