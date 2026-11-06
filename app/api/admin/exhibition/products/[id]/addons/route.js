// app/api/admin/exhibition/products/[id]/addons/route.js
// Optional services sold with one product (installation, assembly …). They are
// priced per unit and can only be bought alongside the product, so they never
// appear as shelf items and never hold stock.
//   GET    — the product's services
//   POST   — add one { name, price }
//   DELETE — remove one (?addon_id=)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function loadProduct(supabase, id) {
  const { data, error } = await supabase
    .from('exhibition_products')
    .select('id, cycle_id, vendor_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function GET(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Invalid product' }, { status: 400 })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_product_addons')
      .select('id, product_id, name, price, unit, active, sort_order')
      .eq('product_id', id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, addons: data || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load services' }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Invalid product' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const name = sanitizeString(body.name || '', { maxLength: 120, encodeHtml: false })
    if (!name) return NextResponse.json({ ok: false, error: 'Service name is required' }, { status: 400 })
    const price = Math.trunc(Number(body.price))
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ ok: false, error: 'Service price cannot be negative' }, { status: 400 })

    const supabase = createClient()
    const product = await loadProduct(supabase, id)
    if (!product) return NextResponse.json({ ok: false, error: 'Product not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('exhibition_product_addons')
      .insert({
        cycle_id: Number(product.cycle_id),
        product_id: id,
        vendor_id: Number(product.vendor_id),
        name,
        price,
        unit: sanitizeString(body.unit || 'service', { maxLength: 30, encodeHtml: false }) || 'service',
      })
      .select('id, product_id, name, price, unit, active, sort_order')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, addon: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to add service' }, { status: 500 })
  }
}

export async function PATCH(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    const body = await request.json().catch(() => ({}))
    const addonId = Math.trunc(Number(body.addon_id || 0))
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(addonId) || addonId <= 0) {
      return NextResponse.json({ ok: false, error: 'Product and addon_id are required' }, { status: 400 })
    }

    const patch = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) {
      const name = sanitizeString(body.name || '', { maxLength: 120, encodeHtml: false })
      if (!name) return NextResponse.json({ ok: false, error: 'Service name is required' }, { status: 400 })
      patch.name = name
    }
    if (body.price !== undefined) {
      const price = Math.trunc(Number(body.price))
      if (!Number.isFinite(price) || price < 0) return NextResponse.json({ ok: false, error: 'Service price cannot be negative' }, { status: 400 })
      patch.price = price
    }
    if (Object.keys(patch).length <= 1) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_product_addons')
      .update(patch)
      .eq('id', addonId)
      .eq('product_id', id)
      .select('id, product_id, name, price, unit, active, sort_order')
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ ok: false, error: 'Service not found' }, { status: 404 })
    return NextResponse.json({ ok: true, addon: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update service' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    const addonId = Math.trunc(Number(new URL(request.url).searchParams.get('addon_id') || 0))
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(addonId) || addonId <= 0) {
      return NextResponse.json({ ok: false, error: 'Product and addon_id are required' }, { status: 400 })
    }

    const supabase = createClient()
    // Services already sold stay on the order lines that recorded them, so the
    // row is deactivated rather than deleted and the history stays readable.
    const { error } = await supabase
      .from('exhibition_product_addons')
      .update({ active: false })
      .eq('id', addonId)
      .eq('product_id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to remove service' }, { status: 500 })
  }
}
