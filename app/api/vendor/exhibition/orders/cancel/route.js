// app/api/vendor/exhibition/orders/cancel/route.js
// POST /api/vendor/exhibition/orders/cancel   body: { id | ids, reason? }
//
// A vendor can cancel an order that carries their lines, while it is still
// Pending or Approved — the same cancellable window the admin desk has. The
// order status is order-wide, so this cancels the whole invoice (any other
// stand's lines included) and puts shop-reserved stock back on the shelf.
//
// Restoring is deliberately NOT available here: /api/admin/exhibition/orders/
// restore is the only way back, so a cancellation a vendor makes has to be
// reversed by the co-op. That is also why the vendor UI says so before it acts.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { validateNumber, sanitizeString } from '@/lib/validation'
import { getVendorContext } from '../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CANCELLABLE = ['Pending', 'Approved']

function asIdArray(input) {
  if (Array.isArray(input)) return input
  if (input == null) return []
  return [input]
}

export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const ids = asIdArray(body.ids ?? body.id)
      .map((v) => validateNumber(v, { min: 1, integer: true }))
      .filter((r) => r.isValid)
      .map((r) => r.value)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'Invalid order id(s)' }, { status: 400 })

    const reason = sanitizeString(body.reason || '', { maxLength: 300, encodeHtml: false })
    const supabase = createClient()

    // Ownership: an order is this vendor's business only if it holds one of
    // their lines. Without this a stand could cancel the whole exhibition.
    const { data: ownLines, error: ownErr } = await supabase
      .from('exhibition_order_lines')
      .select('order_id')
      .eq('vendor_id', ctx.vendor_id)
      .in('order_id', ids)
    if (ownErr) return NextResponse.json({ ok: false, error: ownErr.message }, { status: 500 })
    const mine = new Set((ownLines || []).map((l) => Number(l.order_id)))

    const { data: rows, error: selErr } = await supabase
      .from('exhibition_orders')
      .select('id, status')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const toCancel = ids.filter(
      (id) => mine.has(Number(id)) && CANCELLABLE.includes(String(byId.get(id)?.status || ''))
    )
    const failed = ids
      .filter((id) => !toCancel.includes(id))
      .map((id) => {
        const entry = { id, status: String(byId.get(id)?.status || '') }
        if (!mine.has(Number(id))) entry.reason = 'Not your order'
        else if (!CANCELLABLE.includes(entry.status)) entry.reason = 'Already completed'
        return entry
      })
    if (!toCancel.length) {
      const notMine = failed.length > 0 && failed.every((f) => f.reason === 'Not your order')
      return NextResponse.json(
        {
          ok: false,
          error: notMine
            ? 'That order does not contain any of your products.'
            : 'Only pending or approved orders can be cancelled.',
          failed,
        },
        { status: 403 }
      )
    }

    const now = new Date().toISOString()
    const updates = { status: 'Cancelled', cancelled_at: now, restored_at: null, updated_at: now }
    if (reason) updates.cancelled_reason = reason

    // Shop-originated lines reserved stock at checkout; counter-invoice lines
    // have no product_id and are ignored.
    const { data: reservedLines } = await supabase
      .from('exhibition_order_lines')
      .select('product_id, qty')
      .in('order_id', toCancel)
      .not('product_id', 'is', null)
    const releaseByProduct = new Map()
    for (const line of reservedLines || []) {
      const pid = Number(line.product_id)
      const qty = Number(line.qty || 0)
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue
      releaseByProduct.set(pid, (releaseByProduct.get(pid) || 0) + qty)
    }

    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update(updates)
      .in('id', toCancel)
      .in('status', CANCELLABLE)
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    let stockReleaseWarning = ''
    if (releaseByProduct.size) {
      const { error: releaseErr } = await supabase.rpc('exhibition_release_stock', {
        p_items: [...releaseByProduct.entries()].map(([product_id, qty]) => ({ product_id, qty })),
      })
      if (releaseErr) stockReleaseWarning = releaseErr.message || 'Failed to release stock'
    }

    await logExhibitionAudit(toCancel, {
      action: 'Cancelled',
      actorType: 'vendor',
      actorLabel: `Vendor · ${ctx.vendor_code || ctx.vendor_id}`,
      note: reason || 'Cancelled from the vendor order list',
    })

    return NextResponse.json({
      ok: true,
      cancelled: toCancel,
      failed,
      ...(stockReleaseWarning ? { warning: stockReleaseWarning } : {}),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
