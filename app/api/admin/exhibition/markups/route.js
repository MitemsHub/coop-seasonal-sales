// app/api/admin/exhibition/markups/route.js
// Admin markup page — per-member negotiated prices (the person who beats a
// price gets their own price) + the general admin_markup adjustment.
//   GET    — products (with admin_markup + negotiated-price counts) and, when
//            ?product_id is given, that product's per-member prices
//   PUT    — upsert a per-member price { product_id, member_id, price, note }
//   DELETE — remove a per-member price { product_id, member_id }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const productId = Math.trunc(Number(searchParams.get('product_id') || 0))
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    const q = String(searchParams.get('q') || '').trim()

    const supabase = createClient()

    if (productId > 0) {
      // A single product's per-member prices
      const { data, error } = await supabase
        .from('exhibition_member_prices')
        .select('id, product_id, member_id, price, set_by, note, updated_at')
        .eq('product_id', productId)
        .order('updated_at', { ascending: false })
        .limit(500)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, prices: data || [] })
    }

    // All products with negotiated-price counts (for the markup list)
    let query = supabase
      .from('exhibition_products')
      .select('id, cycle_id, vendor_id, name, sku, unit, vendor_price, admin_markup, status, vendors:vendor_id(name)')
      .order('name')
    if (cycleId > 0) query = query.eq('cycle_id', cycleId)
    if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)

    const { data, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const products = data || []
    const ids = products.map((p) => Number(p.id))
    let countByProduct = new Map()
    if (ids.length) {
      const { data: rows } = await supabase
        .from('exhibition_member_prices')
        .select('product_id')
        .in('product_id', ids)
      for (const r of rows || []) {
        countByProduct.set(Number(r.product_id), (countByProduct.get(Number(r.product_id)) || 0) + 1)
      }
    }

    return NextResponse.json({
      ok: true,
      products: products.map((p) => ({
        ...p,
        vendor_name: p.vendors?.name || '',
        final_price: Number(p.vendor_price || 0) + Number(p.admin_markup || 0),
        negotiated_count: countByProduct.get(Number(p.id)) || 0,
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load markups' }, { status: 500 })
  }
}

export async function PUT(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const productId = Math.trunc(Number(body.product_id || 0))
    if (!Number.isFinite(productId) || productId <= 0) return NextResponse.json({ ok: false, error: 'Product is required' }, { status: 400 })
    const memberId = sanitizeString(body.member_id || '', { maxLength: 50, encodeHtml: false }).toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'Member is required' }, { status: 400 })
    const price = Math.trunc(Number(body.price))
    if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ ok: false, error: 'Price must be greater than zero' }, { status: 400 })
    const note = sanitizeString(body.note || '', { maxLength: 200, encodeHtml: false })

    const supabase = createClient()
    const { data: product } = await supabase.from('exhibition_products').select('id, cycle_id').eq('id', productId).maybeSingle()
    if (!product) return NextResponse.json({ ok: false, error: 'Product not found' }, { status: 404 })

    const { data: member } = await supabase.from('members').select('member_id, full_name').eq('member_id', memberId).maybeSingle()
    if (!member) return NextResponse.json({ ok: false, error: `Member "${memberId}" not found` }, { status: 404 })

    const { data, error } = await supabase
      .from('exhibition_member_prices')
      .upsert(
        { cycle_id: Number(product.cycle_id), product_id: productId, member_id: memberId, price, set_by: 'admin', note },
        { onConflict: 'cycle_id,product_id,member_id' }
      )
      .select('id, product_id, member_id, price, set_by, note, updated_at')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, price: { ...data, member_name: member.full_name || '' } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to save price' }, { status: 500 })
  }
}

export async function DELETE(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const productId = Math.trunc(Number(body.product_id || 0))
    const memberId = sanitizeString(body.member_id || '', { maxLength: 50, encodeHtml: false }).toUpperCase()
    if (!Number.isFinite(productId) || productId <= 0 || !memberId) {
      return NextResponse.json({ ok: false, error: 'product_id and member_id are required' }, { status: 400 })
    }

    const supabase = createClient()
    const { error } = await supabase
      .from('exhibition_member_prices')
      .delete()
      .eq('product_id', productId)
      .eq('member_id', memberId)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to remove price' }, { status: 500 })
  }
}
