// app/api/admin/exhibition/products/[id]/route.js
// PATCH — update a product (the admin markup page uses admin_markup here,
//         plus qty, status, price, category…)
// DELETE — remove a product (blocked when on an order — archive instead)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Invalid product' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const supabase = createClient()
    const updates = {}

    if (body.name !== undefined) {
      const name = sanitizeString(body.name || '', { maxLength: 255, encodeHtml: false })
      if (!name) return NextResponse.json({ ok: false, error: 'Product name cannot be empty' }, { status: 400 })
      updates.name = name
    }
    if (body.unit !== undefined) updates.unit = sanitizeString(body.unit || 'each', { maxLength: 30, encodeHtml: false })
    if (body.vendor_price !== undefined) {
      const price = Math.max(0, Math.trunc(Number(body.vendor_price)))
      if (price <= 0) return NextResponse.json({ ok: false, error: 'Price must be greater than zero' }, { status: 400 })
      updates.vendor_price = price
    }
    if (body.admin_markup !== undefined) {
      const markup = Math.trunc(Number(body.admin_markup))
      if (!Number.isFinite(markup)) return NextResponse.json({ ok: false, error: 'Invalid markup' }, { status: 400 })
      updates.admin_markup = markup
    }
    if (body.qty !== undefined) updates.qty = body.qty === '' || body.qty === null ? null : Math.max(0, Math.trunc(Number(body.qty)))
    if (body.category_id !== undefined) updates.category_id = body.category_id ? Math.trunc(Number(body.category_id)) : null
    if (body.image_url !== undefined) updates.image_url = sanitizeString(body.image_url || '', { maxLength: 500, encodeHtml: false })
    if (body.status !== undefined && ['draft', 'active', 'archived'].includes(body.status)) updates.status = body.status

    if (!Object.keys(updates).length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    const { data, error } = await supabase
      .from('exhibition_products')
      .update(updates)
      .eq('id', id)
      .select('id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, admin_markup, qty, image_url, status, created_at')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      product: { ...data, final_price: Number(data.vendor_price || 0) + Number(data.admin_markup || 0) },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update product' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Invalid product' }, { status: 400 })

    const supabase = createClient()
    const { data: product } = await supabase.from('exhibition_products').select('id, name').eq('id', id).maybeSingle()
    if (!product) return NextResponse.json({ ok: false, error: 'Product not found' }, { status: 404 })

    const { data: lines } = await supabase.from('exhibition_order_lines').select('id').eq('product_id', id).limit(1)
    if (lines?.length) {
      return NextResponse.json(
        { ok: false, error: `"${product.name}" is on an order and can't be deleted. Archive it instead.` },
        { status: 409 }
      )
    }

    const { error } = await supabase.from('exhibition_products').delete().eq('id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to delete product' }, { status: 500 })
  }
}
