import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'
import { cleanProductImages } from '@/lib/exhibitionProductImages'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SELECT_COLS =
  'id, cycle_id, vendor_id, branch_id, category_id, name, description, sku, unit, vendor_price, discount_pct, pending_discount_pct, qty, image_url, status, approval_status, pending_vendor_price, approval_requested_at, created_at'

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
    const discountChanges = {}

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
    if (body.discount_pct !== undefined && body.discount_pct !== null && body.discount_pct !== '') {
      const pct = Math.trunc(Number(body.discount_pct))
      if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
        return NextResponse.json({ error: 'Discount must be between 0 and 90%' }, { status: 400 })
      }
      discountChanges.discount_pct = pct
    }
    if (body.qty !== undefined) {
      patch.qty = body.qty === '' || body.qty === null ? null : Math.max(0, Number(body.qty))
    }
    if (body.category_id !== undefined) patch.category_id = body.category_id ? Number(body.category_id) : null
    if (body.image_urls !== undefined) {
      const images = cleanProductImages(body.image_urls)
      patch.image_urls = images
      // The cover stays in step with the first photo so older screens keep
      // showing the right picture.
      patch.image_url = images[0] || ''
    } else if (body.image_url !== undefined) {
      patch.image_url = String(body.image_url || '').trim()
      patch.image_urls = patch.image_url ? [patch.image_url] : []
    }
    if (body.description !== undefined) patch.description = String(body.description || '').trim().slice(0, 2000)

    const { data: existing, error: existingError } = await supabase
      .from('exhibition_products')
      .select('id, status, approval_status, vendor_price')
      .eq('id', id)
      .eq('vendor_id', ctx.vendor_id)
      .maybeSingle()
    if (existingError) {
      return NextResponse.json({ error: existingError.message || 'Failed to load product' }, { status: 500 })
    }
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

    // A price or discount change on a product that is already on sale is a
    // request, not an edit: the shop keeps selling at the approved terms until
    // an admin approves the new ones. Drafts can be edited freely.
    const hasTermsChange = Object.keys(priceChanges).length > 0 || Object.keys(discountChanges).length > 0
    if (hasTermsChange && existing.status === 'active') {
      if (priceChanges.vendor_price !== undefined) patch.pending_vendor_price = priceChanges.vendor_price
      if (discountChanges.discount_pct !== undefined) patch.pending_discount_pct = discountChanges.discount_pct
      patch.approval_status = 'pending'
      patch.approval_requested_at = new Date().toISOString()
    } else {
      Object.assign(patch, priceChanges, discountChanges)
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    // image_urls arrives with its own migration: if the column is not there
    // yet, save everything else rather than refusing the edit.
    let saved = await supabase
      .from('exhibition_products')
      .update(patch)
      .eq('id', id)
      .eq('vendor_id', ctx.vendor_id)
      .select(SELECT_COLS)
      .single()
    if (saved.error && /image_urls/i.test(String(saved.error.message || ''))) {
      const { image_urls, ...legacyPatch } = patch
      saved = await supabase
        .from('exhibition_products')
        .update(legacyPatch)
        .eq('id', id)
        .eq('vendor_id', ctx.vendor_id)
        .select(SELECT_COLS)
        .single()
    }
    const { data, error } = saved
    if (error) return NextResponse.json({ error: error.message || 'Failed to update product' }, { status: 500 })

    // Every price edit is written down, so a dispute has a record of what was
    // asked for, when, and by whom. A discount-only change is noted on the
    // price row only when the price itself moved.
    if (Object.keys(priceChanges).length) {
      await supabase.from('exhibition_price_history').insert({
        product_id: id,
        cycle_id: ctx.cycle_id || null,
        vendor_id: ctx.vendor_id,
        old_vendor_price: Number(existing.vendor_price || 0),
        new_vendor_price:
          priceChanges.vendor_price !== undefined
            ? Math.trunc(priceChanges.vendor_price)
            : Number(existing.vendor_price || 0),
        changed_by: 'vendor',
        changed_by_label:
          data.approval_status === 'pending' ? 'Vendor request (pending approval)' : 'Vendor edit',
        note: data.approval_status === 'pending' ? 'Price change awaiting admin approval' : '',
      })
    }

    return NextResponse.json({
      ok: true,
      pending_approval: data.approval_status === 'pending',
      product: {
        ...data,
        final_price: Number(data.vendor_price || 0),
        member_price: Math.round((Number(data.vendor_price || 0) * (100 - Number(data.discount_pct || 0))) / 100),
      },
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

    const { data: existing, error: existingError } = await supabase
      .from('exhibition_products')
      .select('id, name, status, approval_status')
      .eq('id', id)
      .eq('vendor_id', ctx.vendor_id)
      .maybeSingle()
    if (existingError) {
      return NextResponse.json({ error: existingError.message || 'Failed to load product' }, { status: 500 })
    }
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    // Unapproved products are the vendor's own drafts and can go. An approved
    // product may already be on a member's order, so it is archived instead.
    if (existing.approval_status === 'approved' && existing.status !== 'archived') {
      return NextResponse.json(
        { error: `"${existing.name}" is already approved. Archive it instead of deleting it.` },
        { status: 409 }
      )
    }

    const { error } = await supabase.from('exhibition_products').delete().eq('id', id).eq('vendor_id', ctx.vendor_id)
    if (error) {
      if (String(error?.code || '') === '23503') {
        return NextResponse.json(
          {
            error:
              existing.status === 'archived'
                ? `"${existing.name}" is on past orders, so it can't be deleted. It is already archived and no longer appears in the shop.`
                : `"${existing.name}" is on an order and can't be deleted. Archive it instead.`,
          },
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
