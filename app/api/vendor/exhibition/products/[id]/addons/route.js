// app/api/vendor/exhibition/products/[id]/addons/route.js
// A vendor's own services (installation, assembly …) on one of their products.
// Services carry no stock and are only sold with the product, so the vendor
// prices them here and the shop offers them when a member adds the item.
//   GET    — the product's services
//   POST   — add one { name, price }
//   DELETE — remove one (?addon_id=)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownProduct(supabase, ctx, id) {
  const { data, error } = await supabase
    .from('exhibition_products')
    .select('id, cycle_id, vendor_id')
    .eq('id', id)
    .eq('vendor_id', ctx.vendor_id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function GET(req, { params }) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Invalid product' }, { status: 400 })

    const supabase = createClient()
    const product = await ownProduct(supabase, ctx, id)
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('exhibition_product_addons')
      .select('id, product_id, name, price, unit, active, sort_order')
      .eq('product_id', id)
      .eq('vendor_id', ctx.vendor_id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, addons: data || [] })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load services' }, { status: 500 })
  }
}

export async function POST(req, { params }) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Invalid product' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const name = String(body.name || '').trim().slice(0, 120)
    if (!name) return NextResponse.json({ error: 'Service name is required' }, { status: 400 })
    const price = Math.trunc(Number(body.price))
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Service price cannot be negative' }, { status: 400 })

    const supabase = createClient()
    const product = await ownProduct(supabase, ctx, id)
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('exhibition_product_addons')
      .insert({
        cycle_id: Number(product.cycle_id),
        product_id: id,
        vendor_id: Number(ctx.vendor_id),
        name,
        price,
        unit: 'service',
      })
      .select('id, product_id, name, price, unit, active, sort_order')
      .single()
    if (error) return NextResponse.json({ error: error.message || 'Failed to add service' }, { status: 500 })
    return NextResponse.json({ ok: true, addon: data })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to add service' }, { status: 500 })
  }
}

export async function PATCH(req, { params }) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = Math.trunc(Number(params?.id || 0))
    const body = await req.json().catch(() => ({}))
    const addonId = Math.trunc(Number(body.addon_id || 0))
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(addonId) || addonId <= 0) {
      return NextResponse.json({ error: 'Product and addon_id are required' }, { status: 400 })
    }

    const patch = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) {
      const name = String(body.name || '').trim().slice(0, 120)
      if (!name) return NextResponse.json({ error: 'Service name is required' }, { status: 400 })
      patch.name = name
    }
    if (body.price !== undefined) {
      const price = Math.trunc(Number(body.price))
      if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Service price cannot be negative' }, { status: 400 })
      patch.price = price
    }
    if (Object.keys(patch).length <= 1) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    const supabase = createClient()
    const product = await ownProduct(supabase, ctx, id)
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('exhibition_product_addons')
      .update(patch)
      .eq('id', addonId)
      .eq('product_id', id)
      .eq('vendor_id', ctx.vendor_id)
      .select('id, product_id, name, price, unit, active, sort_order')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    return NextResponse.json({ ok: true, addon: data })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to update service' }, { status: 500 })
  }
}

export async function DELETE(req, { params }) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = Math.trunc(Number(params?.id || 0))
    const addonId = Math.trunc(Number(new URL(req.url).searchParams.get('addon_id') || 0))
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(addonId) || addonId <= 0) {
      return NextResponse.json({ error: 'Product and addon_id are required' }, { status: 400 })
    }

    const supabase = createClient()
    // Past orders keep their service lines, so the row is retired, not deleted.
    const { error } = await supabase
      .from('exhibition_product_addons')
      .update({ active: false })
      .eq('id', addonId)
      .eq('product_id', id)
      .eq('vendor_id', ctx.vendor_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to remove service' }, { status: 500 })
  }
}
