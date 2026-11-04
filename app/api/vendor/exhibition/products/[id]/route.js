import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SELECT_COLS =
  'id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, admin_markup, qty, image_url, status, approval_status, pending_vendor_price, pending_admin_markup, approval_requested_at, created_at'

export async function PATCH(req, { params }) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()
    const id = Number(params?.id)
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Invalid product' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const patch = {}
    const priceChanges = {}

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: 'Product name cannot be empty' }, { status: 400 })
      patch.name = name
    }
    if (body.unit !== undefined) patch.unit = String(body.unit).trim() || 'each'
    if (body.vendor_price !== undefined) {
      const price = Math.max(0, Number(body.vendor_price))
      if (price <= 0) return NextResponse.json({ error: 'Price must be greater than zero' }, { status: 400 })
      priceChanges.vendor_price = price
    }
    if (body.admin_markup !== undefined) {
      const markup = Math.max(0, Number(body.admin_markup))
      if (!Number.isFinite(markup)) return NextResponse.json({ error: 'Invalid discount' }, { status: 400 })
      priceChanges.admin_markup = markup
    }
    if (body.qty !== undefined) {
      patch.qty = body.qty === '' || body.qty === null ? null : Math.max(0, Number(body.qty))
    }
    if (body.category_id !== undefined) patch.category_id = body.category_id ? Number(body.category_id) : null
    if (body.image_url !== undefined) patch.image_url = String(body.image_url || '').trim()

    const { data: existing } = await supabase
      .from('exhibition_products')
      .select('id, status, approval_status')
      .eq('id', id)
      .eq('vendor_id', ctx.vendor_id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    if (body.status !== undefined) {
      if (!['draft', 'active', 'archived'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      // Going live is the admin's decision, not the vendor's. Re-activating an
      // already approved product (un-archiving) stays allowed.
      if (body.status === 'active' && existing.approval_status !== 'approved') {
        return NextResponse.json(
          { error: 'This product is waiting for admin approval before it can go live.' },
          { status: 400 }
        )
      }
      patch.status = body.status
    }

    // A price change on a product that is already on sale is a request, not an
    // edit: the shop keeps selling at the approved price until an admin
    // approves the new one. Drafts can be edited freely.
    if (Object.keys(priceChanges).length && existing.status === 'active') {
      if (priceChanges.vendor_price !== undefined) patch.pending_vendor_price = priceChanges.vendor_price
      if (priceChanges.admin_markup !== undefined) patch.pending_admin_markup = priceChanges.admin_markup
      patch.approval_status = 'pending'
      patch.approval_requested_at = new Date().toISOString()
    } else {
      Object.assign(patch, priceChanges)
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    const { data, error } = await supabase
      .from('exhibition_products')
      .update(patch)
      .eq('id', id)
      .eq('vendor_id', ctx.vendor_id)
      .select(SELECT_COLS)
      .single()
    if (error) return NextResponse.json({ error: error.message || 'Failed to update product' }, { status: 500 })

    return NextResponse.json({
      ok: true,
      pending_approval: data.approval_status === 'pending',
      product: { ...data, final_price: Number(data.vendor_price || 0) + Number(data.admin_markup || 0) },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to update product' }, { status: 500 })
  }
}

export async function DELETE(req, { params }) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()
    const id = Number(params?.id)
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Invalid product' }, { status: 400 })

    const { data: existing } = await supabase
      .from('exhibition_products')
      .select('id, name')
      .eq('id', id)
      .eq('vendor_id', ctx.vendor_id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const { error } = await supabase.from('exhibition_products').delete().eq('id', id).eq('vendor_id', ctx.vendor_id)
    if (error) {
      if (String(error?.code || '') === '23503') {
        return NextResponse.json(
          { error: `"${existing.name}" is on an order and can't be deleted. Archive it instead.` },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message || 'Failed to delete product' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to delete product' }, { status: 500 })
  }
}
