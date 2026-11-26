// app/api/vendor/exhibition/orders/lines/cancel/route.js
// POST /api/vendor/exhibition/orders/lines/cancel
//   body: { order_id (db id), line_ids: number[], reason? }
//
// A vendor withdrawing some — or all — of the items it put on an order. This is
// the partial version of /api/vendor/exhibition/orders/cancel: the lines go,
// and everything that was derived from them is recalculated in one transaction
// so the invoice never sits in a half-cancelled state:
//
//   • the order's principal (sum of the surviving lines' amounts)
//   • loan interest at the rate this order was actually charged, derived from
//     its own total and principal, so interest on what survives and the total
//     can only go down — a cancellation never reprices the member's order
//   • total_qty, and the order's vendor payable for this stand (paid rows are
//     refused — the money has already left)
//   • reserved shop stock for the withdrawn lines, released back on sale
//
// If nothing is left on the order it is cancelled outright, with the same
// stamps a whole-order cancellation writes. Cancelling only lowers a member's
// exposure, so there is no cap to re-check: a member who was inside their room
// before is still inside it after.
//
// Restoring is the admin desk's call, as with any vendor cancellation. The
// withdrawn lines are recorded in the audit detail (name, sku, qty, amount) so
// the co-op can see exactly what came off and what it was worth.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAuditEntries } from '@/lib/exhibitionAudit'
import { validateNumber, sanitizeString } from '@/lib/validation'
import { transactionalQuery } from '@/lib/directDb'
import { getVendorContext } from '../../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CANCELLABLE = ['Pending', 'Approved']

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
    const vendorId = Number(ctx.vendor_id)

    const result = await transactionalQuery(orderDbId, async (q) => {
      const { rows: orderRows } = await q(
        `SELECT id, order_id, status, cycle_id, payment_option, total_amount, total_qty
           FROM public.exhibition_orders
          WHERE id = $1
          FOR UPDATE`,
        [orderDbId]
      )
      const order = orderRows[0]
      if (!order) {
        await q('ROLLBACK')
        return { error: 'Order not found', status: 404 }
      }
      if (!CANCELLABLE.includes(String(order.status))) {
        await q('ROLLBACK')
        return { error: 'Only pending or approved orders can be changed.', status: 409 }
      }

      const { rows: mine } = await q(
        `SELECT id, vendor_id, product_id, product_name, sku, qty, amount, final_price
           FROM public.exhibition_order_lines
          WHERE order_id = $1 AND id = ANY($2::bigint[])
          FOR UPDATE`,
        [orderDbId, lineIds]
      )
      const found = new Set(mine.map((l) => Number(l.id)))
      const missing = lineIds.filter((id) => !found.has(id))
      if (missing.length) {
        await q('ROLLBACK')
        return { error: 'Those items are not on this order.', status: 404, missing }
      }
      const notMine = mine.filter((l) => Number(l.vendor_id) !== vendorId).map((l) => Number(l.id))
      if (notMine.length) {
        await q('ROLLBACK')
        return {
          error: 'Those items belong to another stand — a vendor can only cancel its own items.',
          status: 403,
          lines: notMine,
        }
      }

      // A paid payable cannot be rewritten: the co-op has already settled it.
      const { rows: payableRows } = await q(
        `SELECT id, amount, paid
           FROM public.exhibition_vendor_payment_status
          WHERE order_id = $1 AND vendor_id = $2
          FOR UPDATE`,
        [orderDbId, vendorId]
      )
      const payable = payableRows[0]
      if (payable?.paid) {
        await q('ROLLBACK')
        return {
          error: 'The payout for this order is already marked paid, so its items can no longer be cancelled here.',
          status: 409,
        }
      }

      // Keep the interest the member was actually charged. Deriving it from the
      // order's own numbers — instead of reading the season's current rate —
      // means a cancellation can only lower what is owed: it must not reprice
      // the surviving items under the member's feet.
      const { rows: beforeRows } = await q(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS principal
           FROM public.exhibition_order_lines
          WHERE order_id = $1`,
        [orderDbId]
      )
      const oldPrincipal = Number(beforeRows[0]?.principal || 0)
      const appliedRatePct =
        String(order.payment_option) === 'Loan' && oldPrincipal > 0
          ? Number((((Number(order.total_amount || 0) - oldPrincipal) / oldPrincipal) * 100).toFixed(6))
          : 0

      const cancelledQty = mine.reduce((s, l) => s + Number(l.qty || 0), 0)
      const cancelledAmount = mine.reduce((s, l) => s + Number(l.amount || 0), 0)
      const keepStock = new Map()
      for (const l of mine) {
        const pid = Number(l.product_id)
        const qty = Number(l.qty || 0)
        if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue
        keepStock.set(pid, (keepStock.get(pid) || 0) + qty)
      }

      await q(`DELETE FROM public.exhibition_order_lines WHERE id = ANY($1::bigint[])`, [lineIds])

      // Recompute from what is left, in SQL so the rounding matches every other
      // total in the module (interest is ROUND(principal × rate / 100)).
      const { rows: recalcRows } = await q(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS principal,
                COALESCE(SUM(qty), 0)::int AS qty,
                COUNT(*)::int AS lines,
                (COALESCE(SUM(amount), 0) + CASE WHEN $2 = 'Loan'
                                                 THEN ROUND(COALESCE(SUM(amount), 0) * $3::numeric / 100)
                                                 ELSE 0 END)::bigint AS total
           FROM public.exhibition_order_lines
          WHERE order_id = $1`,
        [orderDbId, String(order.payment_option || ''), appliedRatePct]
      )
      const totals = recalcRows[0]

      const nowIso = new Date().toISOString()
      const emptied = Number(totals.lines) === 0

      if (emptied) {
        await q(
          `UPDATE public.exhibition_orders
              SET status = 'Cancelled',
                  cancelled_at = $2,
                  cancelled_reason = $3,
                  restored_at = NULL,
                  total_amount = 0,
                  total_qty = 0,
                  updated_at = $2
            WHERE id = $1`,
          [orderDbId, nowIso, reason || 'Every item was cancelled by the vendor']
        )
      } else {
        await q(
          `UPDATE public.exhibition_orders
              SET total_amount = $2,
                  total_qty = $3,
                  updated_at = $4
            WHERE id = $1`,
          [orderDbId, Number(totals.total), Number(totals.qty), nowIso]
        )
      }

      if (payable) {
        // The payable holds this stand's principal, not the order's — the other
        // stands' lines are theirs. Interest is the co-op's and never sits here.
        const { rows: vendorRows } = await q(
          `SELECT COALESCE(SUM(amount), 0)::bigint AS principal
             FROM public.exhibition_order_lines
            WHERE order_id = $1 AND vendor_id = $2`,
          [orderDbId, vendorId]
        )
        await q(
          `UPDATE public.exhibition_vendor_payment_status
              SET amount = $2
            WHERE id = $1 AND paid = FALSE`,
          [Number(payable.id), Number(vendorRows[0]?.principal || 0)]
        )
      }

      // Shop lines reserved stock at checkout; counter-invoice lines have no
      // product. Releasing inside the transaction keeps stock and lines in step.
      if (keepStock.size) {
        await q(`SELECT public.exhibition_release_stock($1::jsonb)`, [
          JSON.stringify([...keepStock.entries()].map(([product_id, qty]) => ({ product_id, qty }))),
        ])
      }

      await q('COMMIT')

      return {
        ok: true,
        order: {
          id: Number(orderDbId),
          order_id: order.order_id,
          cycle_id: Number(order.cycle_id || 0),
          status: emptied ? 'Cancelled' : String(order.status),
          total_amount: Number(totals.total),
          total_qty: Number(totals.qty),
          old_total_amount: Number(order.total_amount),
          old_total_qty: Number(order.total_qty),
        },
        removed: mine.map((l) => ({
          id: Number(l.id),
          product_name: l.product_name || '',
          sku: l.sku || '',
          qty: Number(l.qty || 0),
          amount: Number(l.amount || 0),
        })),
        removed_qty: cancelledQty,
        removed_amount: cancelledAmount,
        remaining_lines: Number(totals.lines),
        remaining_principal: Number(totals.principal),
        emptied,
        rate: appliedRatePct,
      }
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
        actorLabel: `Vendor · ${ctx.vendor_code || ctx.vendor_id}`,
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
    })
  } catch (e) {
    console.error('Vendor line cancel failed:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Failed to cancel those items' }, { status: 500 })
  }
}
