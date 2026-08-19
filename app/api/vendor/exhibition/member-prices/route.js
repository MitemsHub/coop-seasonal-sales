import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Verify a product belongs to this vendor (and cycle) — returns { ok, product }.
async function ownProduct(supabase, ctx, productId) {
  if (!Number.isFinite(productId) || productId <= 0) return { ok: false, reason: 'Invalid product' }
  const { data, error } = await supabase
    .from('exhibition_products')
    .select('id, name')
    .eq('id', productId)
    .eq('vendor_id', ctx.vendor_id)
    .maybeSingle()
  if (error) return { ok: false, reason: error.message }
  if (!data) return { ok: false, reason: 'Product not found' }
  return { ok: true, product: data }
}

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const productId = req.nextUrl?.searchParams?.get('product_id')
    let query = supabase
      .from('exhibition_member_prices')
      .select('id, cycle_id, product_id, member_id, price, set_by, note, updated_at, products:product_id(name, sku)')
      .eq('cycle_id', ctx.cycle_id)

    if (productId) {
      const check = await ownProduct(supabase, ctx, Number(productId))
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'Invalid product' || check.reason === 'Product not found' ? 404 : 500 })
      query = query.eq('product_id', Number(productId))
    } else {
      // Only prices on this vendor's own products
      const { data: products } = await supabase
        .from('exhibition_products')
        .select('id')
        .eq('vendor_id', ctx.vendor_id)
      const ids = (products || []).map((p) => p.id)
      if (!ids.length) return NextResponse.json({ ok: true, prices: [] })
      query = query.in('product_id', ids)
    }

    const { data, error } = await query.order('updated_at', { ascending: false }).limit(300)
    if (error) return NextResponse.json({ error: error.message || 'Failed to load prices' }, { status: 500 })

    return NextResponse.json({
      ok: true,
      prices: (data || []).map((p) => ({
        id: p.id,
        product_id: p.product_id,
        product_name: p.products?.name || '',
        product_sku: p.products?.sku || '',
        member_id: p.member_id,
        price: Number(p.price || 0),
        set_by: p.set_by || 'vendor',
        note: p.note || '',
        updated_at: p.updated_at,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load prices' }, { status: 500 })
  }
}

// PUT body: { product_id, member_id, price, note } — create or update.
export async function PUT(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const body = await req.json().catch(() => ({}))
    const productId = Number(body?.product_id)
    const memberId = String(body?.member_id || '').trim()
    const price = Number(body?.price)
    const note = String(body?.note || '').trim().slice(0, 200)

    if (!memberId) return NextResponse.json({ error: 'Member is required' }, { status: 400 })
    if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: 'Price must be greater than zero' }, { status: 400 })

    const check = await ownProduct(supabase, ctx, productId)
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 404 })

    // Confirm the member exists
    const { data: member } = await supabase
      .from('members')
      .select('member_id, full_name')
      .eq('member_id', memberId)
      .maybeSingle()
    if (!member) return NextResponse.json({ error: `Member "${memberId}" not found` }, { status: 404 })

    const { data, error } = await supabase
      .from('exhibition_member_prices')
      .upsert(
        { cycle_id: ctx.cycle_id, product_id, member_id: memberId, price, set_by: 'vendor', note },
        { onConflict: 'cycle_id,product_id,member_id' }
      )
      .select('id, cycle_id, product_id, member_id, price, set_by, note, updated_at')
      .single()
    if (error) {
      if (String(error?.code || '') === '42P01') {
        return NextResponse.json({ error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ error: error.message || 'Failed to save price' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      price: { ...data, member_name: member.full_name || '' },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to save price' }, { status: 500 })
  }
}

// DELETE body: { product_id, member_id }
export async function DELETE(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const body = await req.json().catch(() => ({}))
    const productId = Number(body?.product_id)
    const memberId = String(body?.member_id || '').trim()
    if (!memberId) return NextResponse.json({ error: 'Member is required' }, { status: 400 })

    const check = await ownProduct(supabase, ctx, productId)
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 404 })

    const { error } = await supabase
      .from('exhibition_member_prices')
      .delete()
      .eq('cycle_id', ctx.cycle_id)
      .eq('product_id', productId)
      .eq('member_id', memberId)
    if (error) return NextResponse.json({ error: error.message || 'Failed to remove price' }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to remove price' }, { status: 500 })
  }
}
