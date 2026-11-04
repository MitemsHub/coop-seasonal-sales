// app/api/admin/exhibition/products/bulk/route.js
// Bulk approval: one decision for a queue, not one POST per product.
//   POST { action: 'approve'|'reject', ids: [...], note?: string }
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
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ ok: false, error: 'action must be approve or reject' }, { status: 400 })
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
      .select('id, name, status, vendor_id, cycle_id, vendor_price, admin_markup, pending_vendor_price, pending_admin_markup, approval_status')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    if (action === 'reject') {
      const { error } = await supabase
        .from('exhibition_products')
        .update({
          approval_status: 'rejected',
          approval_note: note,
          approval_reviewed_at: now,
          pending_vendor_price: null,
          pending_admin_markup: null,
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
      const newMarkup = row.pending_admin_markup != null ? Math.trunc(Number(row.pending_admin_markup)) : null
      if (newVendorPrice != null) applied.vendor_price = newVendorPrice
      if (newMarkup != null) applied.admin_markup = newMarkup

      const { error } = await supabase
        .from('exhibition_products')
        .update({
          ...applied,
          status: 'active',
          approval_status: 'approved',
          approval_note: '',
          approval_reviewed_at: now,
          pending_vendor_price: null,
          pending_admin_markup: null,
          approval_requested_at: null,
        })
        .eq('id', row.id)
      if (error) continue

      if (newVendorPrice != null || newMarkup != null) {
        await supabase.from('exhibition_price_history').insert({
          product_id: Number(row.id),
          cycle_id: row.cycle_id ? Number(row.cycle_id) : null,
          vendor_id: row.vendor_id ? Number(row.vendor_id) : null,
          old_vendor_price: Number(row.vendor_price || 0),
          new_vendor_price: newVendorPrice != null ? newVendorPrice : Number(row.vendor_price || 0),
          old_admin_markup: Number(row.admin_markup || 0),
          new_admin_markup: newMarkup != null ? newMarkup : Number(row.admin_markup || 0),
          changed_by: 'admin',
          changed_by_label: 'Admin approval',
          note: 'Pending price applied on approval',
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
