// app/api/vendor/exhibition/orders/lines/cancel/route.js
// POST /api/vendor/exhibition/orders/lines/cancel
//   body: { order_id (db id), line_ids: number[], reason? }
//
// A vendor withdrawing some — or all — of the items it put on an order. The
// withdrawal itself, the recalculated order and the snapshot the admin restores
// from all live in lib/exhibitionOrderLines.js, so this route only authorises
// and writes the audit trail.
//
// Restoring is the admin desk's call: the withdrawn lines are kept in
// exhibition_cancelled_lines, and /api/admin/exhibition/orders/lines/restore
// puts them back.
import { NextResponse } from 'next/server'
import { logExhibitionAuditEntries } from '@/lib/exhibitionAudit'
import { validateNumber, sanitizeString } from '@/lib/validation'
import { cancelVendorLines } from '@/lib/exhibitionOrderLines'
import { getVendorContext } from '../../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asIdArray(input) {
  if (Array.isArray(input)) return input
  if (input == null) return []
  return [input]
}

function toIds(input) {
  return asIdArray(input)
    .map((v) => validateNumber(v, { min: 1, integer: true }))
    .filter((r) => r.isValid)
    .map((r) => r.value)
}

export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const orderDbId = toIds(body.order_id ?? body.id)[0]
    const lineIds = [...new Set(toIds(body.line_ids ?? body.lines))]
    if (!orderDbId) return NextResponse.json({ ok: false, error: 'Invalid order id' }, { status: 400 })
    if (!lineIds.length) return NextResponse.json({ ok: false, error: 'Select at least one item to cancel' }, { status: 400 })

    const reason = sanitizeString(body.reason || '', { maxLength: 300, encodeHtml: false })
    const actorLabel = `Vendor · ${ctx.vendor_code || ctx.vendor_id}`

    const result = await cancelVendorLines({
      orderId: orderDbId,
      vendorId: Number(ctx.vendor_id),
      vendorCode: ctx.vendor_code || '',
      lineIds,
      reason,
      actorLabel,
    })

    if (result?.error) {
      return NextResponse.json({ ok: false, ...result }, { status: result.status || 400 })
    }

    // Trail: the lines that came off, what they were worth, and the order's
    // before/after totals — one row, since it is one action.
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
        ).toLocaleString('en-NG')}`,
        detail: {
          order_id: result.order.order_id,
          removed_lines: result.removed,
          removed_qty: result.removed_qty,
          removed_amount: result.removed_amount,
          old_total: result.order.old_total_amount,
          new_total: result.order.total_amount,
          old_qty: result.order.old_total_qty,
          new_qty: result.order.total_qty,
          applied_interest_rate_pct: result.rate,
          emptied: result.emptied,
          restorable: Boolean(result.archived),
          reason: reason || '',
        },
      },
    ])

    return NextResponse.json({
      ok: true,
      order: result.order,
      removed: result.removed,
      removed_qty: result.removed_qty,
      removed_amount: result.removed_amount,
      remaining_lines: result.remaining_lines,
      emptied: result.emptied,
      restorable: Boolean(result.archived),
    })
  } catch (e) {
    console.error('Vendor line cancel failed:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Failed to cancel those items' }, { status: 500 })
  }
}
