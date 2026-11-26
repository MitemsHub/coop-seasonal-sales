// app/api/vendor/exhibition/orders/cancel/route.js
// POST /api/vendor/exhibition/orders/cancel   body: { id | ids, reason? }
//
// Cancelling an order from the vendor's own list. The button promises the order
// goes away from the member's orders, so it does exactly that for this stand's
// goods: every line the vendor has on the order comes off, the order total, its
// loan interest, the quantities, this stand's payable and the reserved stock are
// recalculated together, and the order is cancelled outright when nothing is
// left on it.
//
// On a shared invoice that means the other stands keep their items and the
// order stays open — refusing the whole action instead (the old behaviour) made
// a vendor unable to withdraw its own goods from a mixed order. The withdrawn
// lines are kept in exhibition_cancelled_lines so the co-op can restore them
// from /api/admin/exhibition/orders/restore or .../lines/restore; that is the
// only way back, which is what the vendor dialog says.
import { NextResponse } from 'next/server'
import { logExhibitionAuditEntries } from '@/lib/exhibitionAudit'
import { validateNumber, sanitizeString } from '@/lib/validation'
import { cancelVendorLines } from '@/lib/exhibitionOrderLines'
import { getVendorContext } from '../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const ids = [...new Set(
      asIdArray(body.ids ?? body.id)
        .map((v) => validateNumber(v, { min: 1, integer: true }))
        .filter((r) => r.isValid)
        .map((r) => r.value)
    )]
    if (!ids.length) return NextResponse.json({ ok: false, error: 'Invalid order id(s)' }, { status: 400 })

    const reason = sanitizeString(body.reason || '', { maxLength: 300, encodeHtml: false })
    const actorLabel = `Vendor · ${ctx.vendor_code || ctx.vendor_id}`

    const cancelled = []
    const orders = []
    const failed = []

    for (const id of ids) {
      const result = await cancelVendorLines({
        orderId: id,
        vendorId: Number(ctx.vendor_id),
        vendorCode: ctx.vendor_code || '',
        lineIds: null,
        reason,
        actorLabel,
      })
      if (result?.error) {
        failed.push({ id, status: '', reason: result.error, code: result.status || 400 })
        continue
      }
      cancelled.push(id)
      orders.push({
        id: result.order.id,
        order_id: result.order.order_id,
        cycle_id: result.order.cycle_id,
        status: result.order.status,
        total_amount: result.order.total_amount,
        total_qty: result.order.total_qty,
        old_total_amount: result.order.old_total_amount,
        removed_qty: result.removed_qty,
        removed_amount: result.removed_amount,
        remaining_lines: result.remaining_lines,
        emptied: result.emptied,
        restorable: Boolean(result.archived),
      })

      const removedLabel = result.removed
        .map((l) => `${l.product_name || 'Item'}${l.qty ? ` × ${l.qty}` : ''}`)
        .slice(0, 6)
        .join(', ')
      await logExhibitionAuditEntries([
        {
          orderId: result.order.id,
          cycleId: Number(result.order.cycle_id || 0),
          action: result.emptied ? 'Cancelled' : 'Lines cancelled',
          actorType: 'vendor',
          actorLabel,
          note: `${removedLabel}${result.removed.length > 6 ? ` +${result.removed.length - 6} more` : ''}${
            reason ? ` — ${reason}` : ''
          } · total NGN ${Number(result.order.old_total_amount || 0).toLocaleString('en-NG')} → ${Number(
            result.order.total_amount || 0
          ).toLocaleString('en-NG')}${result.emptied ? ' · order cancelled, nothing left' : ' · order kept for the other stands'}`,
          detail: {
            order_id: result.order.order_id,
            removed_lines: result.removed,
            removed_qty: result.removed_qty,
            removed_amount: result.removed_amount,
            old_total: result.order.old_total_amount,
            new_total: result.order.total_amount,
            emptied: result.emptied,
            restorable: Boolean(result.archived),
            reason: reason || '',
          },
        },
      ])
    }

    if (!cancelled.length) {
      const message =
        failed.length === 1
          ? failed[0].reason
          : 'Only orders that are pending or approved, and contain your items, can be cancelled.'
      return NextResponse.json({ ok: false, error: message, failed }, { status: 409 })
    }

    return NextResponse.json({ ok: true, cancelled, orders, failed })
  } catch (e) {
    console.error('Vendor order cancel failed:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
