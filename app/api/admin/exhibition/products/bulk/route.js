// app/api/admin/exhibition/products/bulk/route.js
// Bulk approval: one decision for a queue, not one POST per product.
//   POST { action: 'approve'|'unapprove'|'reject', ids: [...], note?: string }
// Approving applies any pending price, publishes the product and tells the
// stand's followers (first publish only). Every applied price change is written
// to exhibition_price_history so a dispute has a record.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { notifyStandFollowers } from '@/lib/notifyStandFollowers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const session = await validateSession(req, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '').toLowerCase()
    if (action !== 'approve' && action !== 'unapprove' && action !== 'reject') {
      return NextResponse.json(
        { ok: false, error: 'action must be approve, unapprove or reject' },
        { status: 400 }
      )
    }
    const ids = (Array.isArray(body.ids) ? body.ids : [body.ids])
      .map((v) => Math.trunc(Number(v)))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 200)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'No products selected' }, { status: 400 })

    const note = String(body.note || '').trim().slice(0, 300)
    const supabase = createClient()
    const now = new Date().toISOString()

    const { data: rows, error: selErr } = await supabase
      .from('exhibition_products')
      .select('id, name, status, vendor_id, cycle_id, vendor_price, pending_vendor_price, discount_pct, pending_discount_pct, approval_status')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    // Withdrawing an approval given in error. Only a row that carries an
    // approval can be unapproved — the single-product route answers 409 for
    // anything else, and here those ids come back as `skipped`. Shelf status
    // is deliberately untouched: the shop lists active + approved only, so
    // clearing the approval takes the product off the shelf, while the order
    // lines that already exist keep the price they were sold at.
    if (action === 'unapprove') {
      const unapproved = []
      const skipped = []
      for (const row of rows || []) {
        if (row.approval_status !== 'approved') {
          skipped.push(Number(row.id))
          continue
        }
        const { error } = await supabase
          .from('exhibition_products')
          .update({
            approval_status: 'pending',
            approval_note: '',
            approval_reviewed_at: now,
            approval_requested_at: now,
          })
          .eq('id', row.id)
        if (error) continue
        unapproved.push(Number(row.id))
      }
      // Ids that matched no row (deleted since the list loaded) or whose write
      // failed land in `failed`, the same key the approve path uses.
      const failed = ids.filter((id) => !unapproved.includes(id) && !skipped.includes(id))
      return NextResponse.json({ ok: true, unapproved, skipped, failed })
    }

    if (action === 'reject') {
      const { error } = await supabase
        .from('exhibition_products')
        .update({
          approval_status: 'rejected',
          approval_note: note,
          approval_reviewed_at: now,
          pending_vendor_price: null,
          pending_discount_pct: null,
          approval_requested_at: null,
        })
        .in('id', ids)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, rejected: ids.length })
    }

    const approved = []
    for (const row of rows || []) {
      const applied = {}
      const newVendorPrice = row.pending_vendor_price != null ? Math.max(0, Math.trunc(Number(row.pending_vendor_price))) : null
      if (newVendorPrice != null) applied.vendor_price = newVendorPrice
      const newDiscount = row.pending_discount_pct != null
        ? Math.min(90, Math.max(0, Math.trunc(Number(row.pending_discount_pct))))
        : null
      if (newDiscount != null) applied.discount_pct = newDiscount

      const { error } = await supabase
        .from('exhibition_products')
        .update({
          ...applied,
          status: 'active',
          approval_status: 'approved',
          approval_note: '',
          approval_reviewed_at: now,
          pending_vendor_price: null,
          pending_discount_pct: null,
          approval_requested_at: null,
        })
        .eq('id', row.id)
      if (error) continue

      if (newVendorPrice != null || newDiscount != null) {
        await supabase.from('exhibition_price_history').insert({
          product_id: Number(row.id),
          cycle_id: row.cycle_id ? Number(row.cycle_id) : null,
          vendor_id: row.vendor_id ? Number(row.vendor_id) : null,
          old_vendor_price: Number(row.vendor_price || 0),
          new_vendor_price: newVendorPrice != null ? newVendorPrice : Number(row.vendor_price || 0),
          changed_by: 'admin',
          changed_by_label: 'Admin approval',
          note: newDiscount != null
            ? `Pending discount applied on approval (${newDiscount}% off)`
            : 'Pending price applied on approval',
        })
      }
      approved.push(Number(row.id))

      if (row.status !== 'active') {
        await notifyStandFollowers(supabase, {
          vendorId: row.vendor_id,
          productId: row.id,
          productName: row.name,
        })
      }
    }

    return NextResponse.json({ ok: true, approved, failed: ids.filter((id) => !approved.includes(id)) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Bulk approval failed' }, { status: 500 })
  }
}
