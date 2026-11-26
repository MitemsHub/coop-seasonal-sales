// lib/exhibitionOrderLines.js
// Taking items off an exhibition order — and putting them back.
//
// Cancelling used to DELETE the line rows, so the restore the vendor dialogs
// promised had nothing left to act on: an admin could only see that the item
// was gone, never bring it back. A withdrawal now moves each line into
// exhibition_cancelled_lines (which order it came from, what it was worth, the
// interest rate that order was charged, who took it off and why) before the
// live row is removed. The admin restores from there.
//
// Both directions run in one transaction and share the same recalculation, so
// the order total, its loan interest, quantities, the stands' payables and the
// reserved stock always agree with the lines that are actually on the order.
//
// Interest is derived from the order itself — total minus principal — rather
// than from the season's current rate, so removing or restoring an item can
// only change what is owed by that item. It never reprices the rest.
import { transactionalQuery } from './directDb'

export const OPEN_ORDER_STATUSES = ['Pending', 'Approved']
const ARCHIVE = 'public.exhibition_cancelled_lines'

function fail(q, error, status = 400, extra = {}) {
  return q('ROLLBACK').then(() => ({ error, status, ...extra }))
}

export async function lockOrder(q, orderId) {
  const { rows } = await q(
    `SELECT id, order_id, status, cycle_id, source, payment_option, total_amount, total_qty
       FROM public.exhibition_orders
      WHERE id = $1
      FOR UPDATE`,
    [orderId]
  )
  return rows[0] || null
}

// A cancelled line can still be restored only while its snapshot table exists;
// before the migration is applied a cancellation falls back to the old delete.
export async function cancelArchiveReady(q) {
  const { rows } = await q(`SELECT to_regclass($1) IS NOT NULL AS ready`, [ARCHIVE])
  return Boolean(rows[0]?.ready)
}

export function interestRateFromOrder(order, principal) {
  const p = Number(principal || 0)
  if (String(order?.payment_option) !== 'Loan' || p <= 0) return 0
  return Number((((Number(order.total_amount || 0) - p) / p) * 100).toFixed(6))
}

// Sum what is left on the order and write it back. Called after the lines have
// changed, with the rate captured before they did.
export async function recalcOrderTotals(q, orderId, paymentOption, ratePct) {
  const { rows } = await q(
    `WITH live AS (
       SELECT COALESCE(SUM(amount), 0)::bigint AS principal,
              COALESCE(SUM(qty), 0)::int AS qty,
              COUNT(*)::int AS lines
         FROM public.exhibition_order_lines
        WHERE order_id = $1
     )
     SELECT principal, qty, lines,
            (principal + CASE WHEN $2 = 'Loan'
                              THEN ROUND(principal * $3::numeric / 100)
                              ELSE 0 END)::bigint AS total
       FROM live`,
    [orderId, String(paymentOption || ''), Number(ratePct || 0)]
  )
  const totals = rows[0] || { principal: 0, qty: 0, lines: 0, total: 0 }
  await q(
    `UPDATE public.exhibition_orders
        SET total_amount = $2, total_qty = $3, updated_at = NOW()
      WHERE id = $1`,
    [orderId, Number(totals.total), Number(totals.qty)]
  )
  return {
    principal: Number(totals.principal),
    qty: Number(totals.qty),
    lines: Number(totals.lines),
    total: Number(totals.total),
  }
}

// Each stand is paid the principal of its own surviving lines; a stand whose
// lines all came off goes to zero rather than keeping a stale payable.
export async function syncVendorPayables(q, orderId) {
  await q(
    `UPDATE public.exhibition_vendor_payment_status p
        SET amount = s.principal
       FROM (SELECT vendor_id, COALESCE(SUM(amount), 0)::bigint AS principal
               FROM public.exhibition_order_lines
              WHERE order_id = $1
              GROUP BY vendor_id) s
      WHERE p.order_id = $1
        AND p.vendor_id = s.vendor_id
        AND p.paid = FALSE`,
    [orderId]
  )
  await q(
    `UPDATE public.exhibition_vendor_payment_status p
        SET amount = 0
      WHERE p.order_id = $1
        AND p.paid = FALSE
        AND NOT EXISTS (
          SELECT 1 FROM public.exhibition_order_lines l
           WHERE l.order_id = p.order_id AND l.vendor_id = p.vendor_id
        )`,
    [orderId]
  )
}

function stockItems(lines) {
  const byProduct = new Map()
  for (const l of lines || []) {
    const pid = Number(l.product_id)
    const qty = Number(l.qty || 0)
    if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue
    byProduct.set(pid, (byProduct.get(pid) || 0) + qty)
  }
  return [...byProduct.entries()].map(([product_id, qty]) => ({ product_id, qty }))
}

export async function releaseStock(q, lines) {
  const items = stockItems(lines)
  if (!items.length) return
  await q(`SELECT public.exhibition_release_stock($1::jsonb)`, [JSON.stringify(items)])
}

export async function reserveStock(q, lines) {
  const items = stockItems(lines)
  if (!items.length) return
  await q(`SELECT public.exhibition_reserve_stock($1::jsonb)`, [JSON.stringify(items)])
}

// Move the withdrawn rows out of the live table in the same transaction that
// deletes them — either both happen or neither does.
async function archiveLines(q, order, lines, { actorLabel, reason, ratePct }) {
  const ids = lines.map((l) => Number(l.id))
  await q(
    `INSERT INTO ${ARCHIVE}
       (order_id, line_id, cycle_id, vendor_id, vendor_code, product_id, product_name, sku, unit,
        vendor_price, final_price, qty, amount, note, order_status_before, applied_rate_pct,
        cancelled_by, cancelled_reason)
     SELECT l.order_id, l.id, $2, l.vendor_id, $3, l.product_id, l.product_name, l.sku, l.unit,
            l.vendor_price, l.final_price, l.qty, l.amount, COALESCE(l.note, ''), $4, $5, $6, $7
       FROM public.exhibition_order_lines l
      WHERE l.id = ANY($1::bigint[])`,
    [ids, Number(order.cycle_id || 0), String(actorLabel || ''), String(order.status || ''), Number(ratePct || 0), String(actorLabel || ''), String(reason || '')]
  )
  await q(`DELETE FROM public.exhibition_order_lines WHERE id = ANY($1::bigint[])`, [ids])
}

export function describeLines(lines) {
  return (lines || []).map((l) => ({
    id: Number(l.id),
    product_name: l.product_name || '',
    sku: l.sku || '',
    qty: Number(l.qty || 0),
    amount: Number(l.amount || 0),
    vendor_id: Number(l.vendor_id || 0),
  }))
}

// A stand withdrawing some — or all — of its items. `lineIds` null means every
// line that stand has on the order, which is what the order-level cancel uses:
// on a shared invoice it clears this stand's goods and leaves the rest of the
// order standing, recalculated; when nothing is left the order is cancelled.
export async function cancelVendorLines({
  orderId,
  vendorId,
  vendorCode = '',
  lineIds = null,
  reason = '',
  actorLabel = '',
}) {
  const wanted = Array.isArray(lineIds) && lineIds.length ? lineIds.map(Number) : null

  return transactionalQuery(orderId, async (q) => {
    const order = await lockOrder(q, orderId)
    if (!order) return fail(q, 'Order not found', 404)
    if (!OPEN_ORDER_STATUSES.includes(String(order.status))) {
      return fail(q, 'Only pending or approved orders can be changed.', 409)
    }

    const { rows: mine } = await q(
      `SELECT id, vendor_id, product_id, product_name, sku, qty, amount, final_price
         FROM public.exhibition_order_lines
        WHERE order_id = $1 AND vendor_id = $2
          ${wanted ? 'AND id = ANY($3::bigint[])' : ''}
        ORDER BY id
        FOR UPDATE`,
      wanted ? [orderId, Number(vendorId), wanted] : [orderId, Number(vendorId)]
    )
    if (!mine.length) {
      return fail(
        q,
        wanted
          ? 'Those items are not on this order from your stand.'
          : 'This order has no items from your stand.',
        404
      )
    }
    if (wanted && mine.length !== wanted.length) {
      return fail(q, 'Those items are not on this order from your stand.', 403)
    }

    // A paid payable cannot be rewritten: the co-op has already settled it.
    const { rows: payableRows } = await q(
      `SELECT id, amount, paid
         FROM public.exhibition_vendor_payment_status
        WHERE order_id = $1 AND vendor_id = $2
        FOR UPDATE`,
      [orderId, Number(vendorId)]
    )
    const payable = payableRows[0]
    if (payable?.paid) {
      return fail(
        q,
        'The payout for this order is already marked paid, so its items can no longer be cancelled here.',
        409
      )
    }

    const { rows: beforeRows } = await q(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS principal
         FROM public.exhibition_order_lines
        WHERE order_id = $1`,
      [orderId]
    )
    const ratePct = interestRateFromOrder(order, beforeRows[0]?.principal)

    const archived = await cancelArchiveReady(q)
    if (archived) {
      await archiveLines(q, order, mine, {
        actorLabel: actorLabel || `Vendor · ${vendorCode || vendorId}`,
        reason,
        ratePct,
      })
    } else {
      await q(`DELETE FROM public.exhibition_order_lines WHERE id = ANY($1::bigint[])`, [
        mine.map((l) => Number(l.id)),
      ])
    }

    const totals = await recalcOrderTotals(q, orderId, order.payment_option, ratePct)
    const emptied = totals.lines === 0

    if (emptied) {
      await q(
        `UPDATE public.exhibition_orders
            SET status = 'Cancelled',
                cancelled_at = NOW(),
                cancelled_reason = $2,
                restored_at = NULL,
                total_amount = 0,
                total_qty = 0,
                updated_at = NOW()
          WHERE id = $1`,
        [orderId, reason || 'Every item was cancelled by the vendor']
      )
    }

    await syncVendorPayables(q, orderId)
    await releaseStock(q, mine)
    await q('COMMIT')

    return {
      ok: true,
      archived,
      order: {
        id: Number(orderId),
        order_id: order.order_id,
        cycle_id: Number(order.cycle_id || 0),
        status: emptied ? 'Cancelled' : String(order.status),
        payment_option: order.payment_option,
        total_amount: Number(emptied ? 0 : totals.total),
        total_qty: Number(emptied ? 0 : totals.qty),
        old_total_amount: Number(order.total_amount || 0),
        old_total_qty: Number(order.total_qty || 0),
      },
      removed: describeLines(mine),
      removed_qty: mine.reduce((s, l) => s + Number(l.qty || 0), 0),
      removed_amount: mine.reduce((s, l) => s + Number(l.amount || 0), 0),
      remaining_lines: totals.lines,
      remaining_principal: totals.principal,
      emptied,
      rate: ratePct,
    }
  })
}

// Putting withdrawn items back. With `cancelIds` the listed cancellations come
// back onto a live order; with `restoreOrder` every item the order lost comes
// back and the order itself returns to Pending.
export async function restoreOrderItems({
  orderId,
  cancelIds = null,
  actorLabel = 'System admin',
  restoreOrder = false,
}) {
  const ids = Array.isArray(cancelIds) && cancelIds.length ? cancelIds.map(Number) : null

  return transactionalQuery(orderId, async (q) => {
    const order = await lockOrder(q, orderId)
    if (!order) return fail(q, 'Order not found', 404)

    const status = String(order.status)
    const allowed = restoreOrder ? ['Cancelled'] : OPEN_ORDER_STATUSES
    if (!allowed.includes(status)) {
      return fail(
        q,
        restoreOrder
          ? 'Only cancelled orders can be restored.'
          : status === 'Cancelled'
            ? 'This order is cancelled in full — restore the whole order from the Cancelled queue instead.'
            : 'Items can only be restored onto a pending or approved order.',
        409
      )
    }

    const ready = await cancelArchiveReady(q)
    if (!ready) {
      return fail(q, 'The cancelled-lines migration has not been applied yet (migrations/add-exhibition-cancelled-lines.sql).', 500)
    }

    const { rows: archived } = await q(
      `SELECT id, line_id, vendor_id, product_id, product_name, sku, unit,
              vendor_price, final_price, qty, amount, note, applied_rate_pct
         FROM ${ARCHIVE}
        WHERE order_id = $1
          AND restored_at IS NULL
          ${ids ? 'AND id = ANY($2::bigint[])' : ''}
        ORDER BY id
        FOR UPDATE`,
      ids ? [orderId, ids] : [orderId]
    )
    if (!archived.length) {
      if (!restoreOrder) return fail(q, 'There are no cancelled items to restore on this order.', 404)
      // An order the desk cancelled itself kept its lines; there is nothing in
      // the archive, and the lines just need their stock back.
      const { rows: keepRows } = await q(
        `SELECT COUNT(*)::int AS n FROM public.exhibition_order_lines WHERE order_id = $1`,
        [orderId]
      )
      if (!Number(keepRows[0]?.n || 0)) {
        return fail(q, 'Every item on this order was cancelled and none can be put back.', 409)
      }
    }

    const vendorIds = [...new Set(archived.map((r) => Number(r.vendor_id)).filter((n) => Number.isFinite(n) && n > 0))]
    if (vendorIds.length) {
      const { rows: paidRows } = await q(
        `SELECT vendor_id
           FROM public.exhibition_vendor_payment_status
          WHERE order_id = $1 AND paid = TRUE AND vendor_id = ANY($2::bigint[])`,
        [orderId, vendorIds]
      )
      if (paidRows.length) {
        return fail(q, 'A payout for this order is already marked paid, so its items cannot be put back.', 409)
      }
    }

    // The rate this order was charged when the items came off, so a restore
    // puts back the same money it took away.
    const archivedRate = archived.reduce((max, r) => Math.max(max, Number(r.applied_rate_pct || 0)), 0)
    const { rows: liveBefore } = await q(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS principal
         FROM public.exhibition_order_lines
        WHERE order_id = $1`,
      [orderId]
    )
    const ratePct =
      String(order.payment_option) === 'Loan'
        ? archivedRate || interestRateFromOrder(order, liveBefore[0]?.principal)
        : 0

    const restored = []
    for (const row of archived) {
      const { rows: inserted } = await q(
        `INSERT INTO public.exhibition_order_lines
           (order_id, vendor_id, product_id, product_name, sku, unit, vendor_price, final_price, qty, amount, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          orderId,
          row.vendor_id,
          row.product_id,
          row.product_name,
          row.sku,
          row.unit,
          row.vendor_price,
          row.final_price,
          row.qty,
          row.amount,
          row.note || '',
        ]
      )
      const lineId = Number(inserted[0]?.id || 0)
      await q(
        `UPDATE ${ARCHIVE}
            SET restored_at = NOW(), restored_by = $2, restored_line_id = $3
          WHERE id = $1`,
        [Number(row.id), String(actorLabel || ''), lineId || null]
      )
      restored.push({
        cancel_id: Number(row.id),
        line_id: lineId,
        product_name: row.product_name || '',
        sku: row.sku || '',
        qty: Number(row.qty || 0),
        amount: Number(row.amount || 0),
        vendor_id: Number(row.vendor_id || 0),
      })
    }

    if (restoreOrder) {
      // The whole order was cancelled, so every unit on it (the restored items
      // and the lines that survived) was released. Take them all back.
      const { rows: liveLines } = await q(
        `SELECT product_id, qty FROM public.exhibition_order_lines WHERE order_id = $1`,
        [orderId]
      )
      await reserveStock(q, liveLines)
    } else {
      await reserveStock(q, archived)
    }

    const totals = await recalcOrderTotals(q, orderId, order.payment_option, ratePct)
    if (totals.lines === 0) {
      return fail(q, 'There is nothing left on this order to restore.', 409)
    }

    if (restoreOrder) {
      await q(
        `UPDATE public.exhibition_orders
            SET status = 'Pending',
                approved_at = NULL,
                delivered_at = NULL,
                member_confirmed_at = NULL,
                member_confirmed_by = '',
                confirmed_by_role = '',
                confirmed_by_code = '',
                cancelled_at = NULL,
                cancelled_reason = '',
                restored_at = NOW(),
                updated_at = NOW()
          WHERE id = $1`,
        [orderId]
      )
    }

    await syncVendorPayables(q, orderId)
    await q('COMMIT')

    return {
      ok: true,
      order: {
        id: Number(orderId),
        order_id: order.order_id,
        cycle_id: Number(order.cycle_id || 0),
        status: restoreOrder ? 'Pending' : String(order.status),
        total_amount: totals.total,
        total_qty: totals.qty,
        previous_total_amount: Number(order.total_amount || 0),
      },
      restored,
      restored_qty: restored.reduce((s, r) => s + Number(r.qty || 0), 0),
      restored_amount: restored.reduce((s, r) => s + Number(r.amount || 0), 0),
      rate: ratePct,
    }
  })
}
