import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../_session'
import { reserveSkus } from '@/lib/skuFormat'
import { cleanProductImages } from '@/lib/exhibitionProductImages'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const url = new URL(req.url)
    const status = url.searchParams.get('status') || ''
    const q = url.searchParams.get('q') || ''

    // description and discount_pct arrive with their own migrations. Read the
    // full row first, then drop whichever column is not there yet, so a deploy
    // ahead of the SQL never blanks the vendor's product page.
    // Photos (image_urls) also arrive with their own migration: try each column
    // set with image_urls first, then without, so a deploy ahead of the SQL
    // never blanks the vendor's product page.
    const colsWithoutImages = [
      'id, cycle_id, vendor_id, branch_id, category_id, name, description, sku, unit, vendor_price, discount_pct, pending_discount_pct, qty, image_url, status, approval_status, approval_note, approval_requested_at, pending_vendor_price, categories:category_id(name)',
      'id, cycle_id, vendor_id, branch_id, category_id, name, description, sku, unit, vendor_price, pending_vendor_price, qty, image_url, status, approval_status, approval_note, approval_requested_at, categories:category_id(name)',
      'id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, pending_vendor_price, qty, image_url, status, approval_status, approval_note, approval_requested_at, categories:category_id(name)',
    ]
    const attempts = colsWithoutImages.flatMap((cols) => [`${cols}, image_urls`, cols])
    // Page past the 1,000-row response cap so a stand with a large catalogue
    // still sees every product in its portal.
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
          .eq('vendor_id', ctx.vendor_id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + PAGE - 1)
        if (status && status !== 'all') query = query.eq('status', status)
        if (q) query = query.ilike('name', `%${q}%`)
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
    if (error) return NextResponse.json({ error: error.message || 'Failed to load products' }, { status: 500 })

    return NextResponse.json({
      ok: true,
      products: (data || []).map((p) => ({
        ...p,
        final_price: Number(p.vendor_price || 0),
        category_name: p.categories?.name || '',
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load products' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const body = await req.json().catch(() => ({}))
    const name = String(body?.name || '').trim()
    const unit = String(body?.unit || '').trim() || 'each'
    const vendorPrice = Math.max(0, Number(body?.vendor_price || 0))
    // The vendor price is the member price; there is no co-op markup.
    const qty = body?.qty === '' || body?.qty === null || body?.qty === undefined ? null : Math.max(0, Number(body?.qty))
    const categoryId = body?.category_id ? Number(body.category_id) : null
    // A product can carry several photos. The first is the cover and is
    // mirrored into image_url for the cart, orders and invoices.
    const images = cleanProductImages(
      Array.isArray(body?.image_urls) ? body.image_urls : [String(body?.image_url || '')]
    )
    const description = String(body?.description || '').trim().slice(0, 2000)
    const discountPct = Math.trunc(Number(body?.discount_pct || 0))
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 90) {
      return NextResponse.json({ error: 'Discount must be between 0 and 90%' }, { status: 400 })
    }
    // A vendor's submission never goes live directly: it lands as a draft and
    // waits in the admin's approval queue.
    const status = 'draft'

    if (!name) return NextResponse.json({ error: 'Product name is required' }, { status: 400 })
    if (vendorPrice <= 0) return NextResponse.json({ error: 'Price must be greater than zero' }, { status: 400 })
    if (!ctx.cycle_id) return NextResponse.json({ error: 'No active exhibition cycle for this vendor' }, { status: 400 })

    // The SKU is generated, never typed: <vendor><name><sequence>. Read every
    // existing SKU (paged past the 1,000-row cap) so a large catalogue cannot
    // produce a duplicate sequence.
    const existingSkus = []
    let skuError = null
    for (let from = 0; ; from += 1000) {
      const res = await supabase
        .from('exhibition_products')
        .select('sku')
        .eq('cycle_id', ctx.cycle_id)
        .eq('vendor_id', ctx.vendor_id)
        .order('id')
        .range(from, from + 999)
      if (res.error) {
        skuError = res.error
        break
      }
      existingSkus.push(...(res.data || []))
      if ((res.data || []).length < 1000) break
    }
    if (skuError) return NextResponse.json({ error: skuError.message || 'Failed to read existing SKUs' }, { status: 500 })
    const [sku] = reserveSkus({
      vendorCode: ctx.vendor_code,
      names: [name],
      existingSkus: existingSkus.map((row) => row.sku),
    })

    const insertRow = {
      cycle_id: ctx.cycle_id,
      vendor_id: ctx.vendor_id,
      branch_id: ctx.branch_id,
      category_id: categoryId,
      name,
      sku,
      unit,
      description,
      vendor_price: vendorPrice,
      discount_pct: discountPct,
      qty,
      image_url: images[0] || '',
      image_urls: images,
      status,
      approval_status: 'pending',
      approval_requested_at: new Date().toISOString(),
    }
    const RETURN_COLS =
      'id, cycle_id, vendor_id, branch_id, category_id, name, description, sku, unit, vendor_price, discount_pct, qty, image_url, status, approval_status, pending_vendor_price, created_at'
    let saved = await supabase.from('exhibition_products').insert(insertRow).select(RETURN_COLS).single()
    if (saved.error && /image_urls/i.test(String(saved.error.message || ''))) {
      const { image_urls, ...legacyRow } = insertRow
      saved = await supabase.from('exhibition_products').insert(legacyRow).select(RETURN_COLS).single()
    }
    const { data, error } = saved

    if (error) {
      if (String(error?.code || '') === '23505') {
        return NextResponse.json({ error: `SKU "${sku}" already exists. Use a unique SKU.` }, { status: 409 })
      }
      if (String(error?.code || '') === '42P01') {
        return NextResponse.json({ error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ error: error.message || 'Failed to create product' }, { status: 500 })
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
    return NextResponse.json({ error: e.message || 'Failed to create product' }, { status: 500 })
  }
}
