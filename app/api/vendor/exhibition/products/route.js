import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../_session'
import { reserveSkus } from '@/lib/skuFormat'

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

    let query = supabase
      .from('exhibition_products')
      .select('id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, admin_markup, qty, image_url, status, approval_status, approval_note, approval_requested_at, pending_vendor_price, pending_admin_markup, categories:category_id(name)')
      .eq('vendor_id', ctx.vendor_id)
      .order('created_at', { ascending: false })

    if (status && status !== 'all') query = query.eq('status', status)
    if (q) query = query.ilike('name', `%${q}%`)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message || 'Failed to load products' }, { status: 500 })

    return NextResponse.json({
      ok: true,
      products: (data || []).map((p) => ({
        ...p,
        final_price: Number(p.vendor_price || 0) + Number(p.admin_markup || 0),
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
    // Vendors set their own markup (₦ on top of their price); the admin can
    // adjust it later on the admin markups page. final = vendor_price + admin_markup.
    const adminMarkup = Math.max(0, Number(body?.admin_markup || 0))
    const qty = body?.qty === '' || body?.qty === null || body?.qty === undefined ? null : Math.max(0, Number(body?.qty))
    const categoryId = body?.category_id ? Number(body.category_id) : null
    const imageUrl = String(body?.image_url || '').trim()
    // A vendor's submission never goes live directly: it lands as a draft and
    // waits in the admin's approval queue.
    const status = 'draft'

    if (!name) return NextResponse.json({ error: 'Product name is required' }, { status: 400 })
    if (vendorPrice <= 0) return NextResponse.json({ error: 'Price must be greater than zero' }, { status: 400 })
    if (!ctx.cycle_id) return NextResponse.json({ error: 'No active exhibition cycle for this vendor' }, { status: 400 })

    // The SKU is generated, never typed: <vendor><name><sequence>.
    const { data: existingSkus } = await supabase
      .from('exhibition_products')
      .select('sku')
      .eq('cycle_id', ctx.cycle_id)
      .eq('vendor_id', ctx.vendor_id)
    const [sku] = reserveSkus({
      vendorCode: ctx.vendor_code,
      names: [name],
      existingSkus: (existingSkus || []).map((row) => row.sku),
    })

    const { data, error } = await supabase
      .from('exhibition_products')
      .insert({
        cycle_id: ctx.cycle_id,
        vendor_id: ctx.vendor_id,
        branch_id: ctx.branch_id,
        category_id: categoryId,
        name,
        sku,
        unit,
        vendor_price: vendorPrice,
        admin_markup: adminMarkup,
        qty,
        image_url: imageUrl,
        status,
        approval_status: 'pending',
        approval_requested_at: new Date().toISOString(),
      })
      .select('id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, admin_markup, qty, image_url, status, approval_status, pending_vendor_price, pending_admin_markup, created_at')
      .single()

    if (error) {
      if (String(error?.code || '') === '23505') {
        return NextResponse.json({ error: `SKU "${sku}" already exists. Use a unique SKU.` }, { status: 409 })
      }
      if (String(error?.code || '') === '42P01') {
        return NextResponse.json({ error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ error: error.message || 'Failed to create product' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, product: { ...data, final_price: vendorPrice } })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to create product' }, { status: 500 })
  }
}
