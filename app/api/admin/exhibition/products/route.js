// app/api/admin/exhibition/products/route.js
// Admin oversight of exhibition products.
//   GET  — list products (filters: cycle_id, vendor_id, status, q)
//   POST — create a product on behalf of a vendor
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'
import { reserveSkus } from '@/lib/skuFormat'
import { cleanProductImages } from '@/lib/exhibitionProductImages'

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
    // description and discount_pct arrive with their own migrations; fall back
    // column by column instead of failing the whole console.
    const colsWithoutImages = [
      'id, cycle_id, vendor_id, branch_id, category_id, name, description, sku, unit, vendor_price, discount_pct, pending_discount_pct, qty, image_url, status, approval_status, pending_vendor_price, approval_requested_at, created_at, vendors:vendor_id(name, code), categories:category_id(name), branches:branch_id(name)',
      'id, cycle_id, vendor_id, branch_id, category_id, name, description, sku, unit, vendor_price, pending_vendor_price, qty, image_url, status, approval_status, approval_requested_at, created_at, vendors:vendor_id(name, code), categories:category_id(name), branches:branch_id(name)',
      'id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, pending_vendor_price, qty, image_url, status, approval_status, approval_requested_at, created_at, vendors:vendor_id(name, code), categories:category_id(name), branches:branch_id(name)',
    ]
    const attempts = colsWithoutImages.flatMap((cols) => [`${cols}, image_urls`, cols])
    // PostgREST stops at its max-rows setting (1,000 on a default project),
    // so a catalogue past that size used to arrive cut off — and the admin
    // queue then reported exactly "1000 waiting for approval". Page through
    // in 1,000-row windows so the list grows with the catalogue.
    const PAGE = 1000
    let data = null
    let error = null
    for (const cols of attempts) {
      const rows = []
      let failed = null
      for (let from = 0; ; from += PAGE) {
        let query = supabase
          .from('exhibition_products')
          .select(cols)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + PAGE - 1)
        if (cycleId > 0) query = query.eq('cycle_id', cycleId)
        if (vendorId > 0) query = query.eq('vendor_id', vendorId)
        if (status && status !== 'all') query = query.eq('status', status)
        if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
        const res = await query
        if (res.error) {
          failed = res.error
          break
        }
        rows.push(...(res.data || []))
        if ((res.data || []).length < PAGE) break
      }
      if (!failed) {
        data = rows
        error = null
        break
      }
      error = failed
      if (!/description|discount_pct|image_urls|schema cache/i.test(String(error.message || ''))) break
    }
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
        final_price: Number(p.vendor_price || 0),
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
    const vendorPrice = Math.max(0, Math.trunc(Number(body.vendor_price || 0)))
    if (vendorPrice <= 0) return NextResponse.json({ ok: false, error: 'Price must be greater than zero' }, { status: 400 })
    const description = sanitizeString(body.description || '', { maxLength: 2000, encodeHtml: false })
    const discountPct = Math.trunc(Number(body.discount_pct || 0))
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 90) {
      return NextResponse.json({ ok: false, error: 'Discount must be between 0 and 90%' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: vendorRow } = await supabase
      .from('exhibition_vendors')
      .select('id, code')
      .eq('id', vendorId)
      .maybeSingle()
    if (!vendorRow) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 404 })

    // Generated SKU, never typed: <vendor><name><sequence>. Read every
    // existing SKU (paged past the 1,000-row cap) so the sequence cannot
    // collide once a stand has a large catalogue.
    const existingSkus = []
    for (let from = 0; ; from += 1000) {
      const res = await supabase
        .from('exhibition_products')
        .select('sku')
        .eq('cycle_id', cycleId)
        .eq('vendor_id', vendorId)
        .order('id')
        .range(from, from + 999)
      if (res.error) break
      existingSkus.push(...(res.data || []))
      if ((res.data || []).length < 1000) break
    }
    const [sku] = reserveSkus({
      vendorCode: vendorRow.code,
      names: [name],
      existingSkus: existingSkus.map((row) => row.sku),
    })

    // The admin desk manages the whole photo list; the first entry is the cover
    // and is mirrored into image_url.
    const images = cleanProductImages(
      (Array.isArray(body.image_urls) ? body.image_urls : [body.image_url || '']).map((url) =>
        sanitizeString(url || '', { maxLength: 500, encodeHtml: false })
      )
    )
    const insertRow = {
      cycle_id: cycleId,
      vendor_id: vendorId,
      branch_id: branchId,
      category_id: body.category_id ? Math.trunc(Number(body.category_id)) : null,
      name,
      sku,
      unit: sanitizeString(body.unit || 'each', { maxLength: 30, encodeHtml: false }),
      description,
      vendor_price: vendorPrice,
      discount_pct: discountPct,
      qty: body.qty === '' || body.qty === null || body.qty === undefined ? null : Math.max(0, Math.trunc(Number(body.qty))),
      image_url: images[0] || '',
      image_urls: images,
      status: body.status === 'draft' ? 'draft' : 'active',
      approval_status: 'approved',
      approval_reviewed_at: new Date().toISOString(),
    }
    const RETURN_COLS =
      'id, cycle_id, vendor_id, branch_id, category_id, name, description, sku, unit, vendor_price, discount_pct, qty, image_url, status, created_at'
    let saved = await supabase.from('exhibition_products').insert(insertRow).select(RETURN_COLS).single()
    if (saved.error && /image_urls/i.test(String(saved.error.message || ''))) {
      const { image_urls, ...legacyRow } = insertRow
      saved = await supabase.from('exhibition_products').insert(legacyRow).select(RETURN_COLS).single()
    }
    const { data, error } = saved
    if (error) {
      if (String(error.code || '') === '23505') {
        return NextResponse.json({ ok: false, error: `SKU "${sku}" already exists. Use a unique SKU.` }, { status: 409 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      product: {
        ...data,
        final_price: vendorPrice,
        member_price: Math.round((vendorPrice * (100 - discountPct)) / 100),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to create product' }, { status: 500 })
  }
}
