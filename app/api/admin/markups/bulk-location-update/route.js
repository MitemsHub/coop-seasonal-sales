// app/api/admin/markups/bulk-location-update/route.js
// Bulk remove specific items (by SKU) from all food orders at a given delivery
// branch.  Used when a product becomes unavailable after orders were placed —
// instead of cancelling entire orders, the admin removes only the affected items.
//
// POST { branch_code, skus: string[], cycle_id: number }
//
// Returns { ok, affected_orders, removed_lines, errors }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { selectWithOptionalColumn } from '@/lib/optionalColumn'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    // Admin sessions are signed with the role only (shared passcode), so this
    // falls back to "admin" — the same actor the post/deliver routes record.
    const actor = String(session.claims?.email || session.claims?.sub || session.claims?.role || 'admin')

    const body = await request.json().catch(() => ({}))
    const branchCode = String(body.branch_code || '').trim()
    const skus = Array.isArray(body.skus) ? body.skus.map((s) => String(s || '').trim()).filter(Boolean) : []
    // Cycle is mandatory: orders belong to a cycle, so removal must be scoped
    // to one cycle — unscoped removals would strip lines from other seasons' orders.
    const cycleId = body.cycle_id != null ? Number(body.cycle_id) : null
    if (cycleId == null || !Number.isFinite(cycleId) || cycleId <= 0) {
      return NextResponse.json({ ok: false, error: 'cycle_id is required' }, { status: 400 })
    }

    if (!branchCode) {
      return NextResponse.json({ ok: false, error: 'branch_code is required' }, { status: 400 })
    }
    if (!skus.length) {
      return NextResponse.json({ ok: false, error: 'At least one SKU is required' }, { status: 400 })
    }

    const supabase = createClient()

    // order_lines uses qty/amount (not quantity/line_total) — these names are
    // what echo through the recalc and the response payload below.

    // 1. Resolve branch id from code
    const { data: branch, error: bErr } = await supabase
      .from('branches')
      .select('id')
      .eq('code', branchCode)
      .maybeSingle()
    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    if (!branch) return NextResponse.json({ ok: false, error: `Branch "${branchCode}" not found` }, { status: 404 })
    const branchId = branch.id

    // 2. Resolve item_ids from SKUs. is_active rides along so the confirmation
    // preview can name retired products (no longer sold) instead of quietly
    // taking their lines off past orders; a database without the column still
    // resolves the items.
    const { data: items, error: iErr } = await selectWithOptionalColumn(
      'item_id, sku, is_active',
      'is_active',
      (cols) => supabase.from('items').select(cols).in('sku', skus)
    )
    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 })
    const foundSkus = (items || []).map((i) => i.sku)
    const missingSkus = skus.filter((s) => !foundSkus.includes(s))
    const itemIds = (items || []).map((i) => i.item_id)

    if (!itemIds.length) {
      return NextResponse.json({ ok: false, error: `No items found for SKUs: ${skus.join(', ')}` }, { status: 404 })
    }

    // 3. Find all orders at this delivery branch in the given cycle
    // (Pending/Posted/Delivered — don't touch Cancelled)
    const { error: cycleColErr } = await supabase.from('orders').select('cycle_id').limit(1)
    if (cycleColErr) {
      return NextResponse.json({ ok: false, error: 'Cycle scoping is required but the orders table has no cycle_id column: ' + cycleColErr.message }, { status: 400 })
    }

    const ordersQuery = supabase
      .from('orders')
      .select('order_id, status, total_amount, payment_option, cycle_id')
      .eq('delivery_branch_id', branchId)
      .eq('cycle_id', cycleId)
      .in('status', ['Pending', 'Posted', 'Delivered'])

    const { data: orders, error: oErr } = await ordersQuery
    if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 })

    if (!orders || orders.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No Pending/Posted/Delivered orders found for this branch',
        affected_orders: 0,
        removed_lines: 0,
        missing_skus: missingSkus,
      })
    }

    const orderIds = orders.map((o) => o.order_id)

    // 4. Find order_lines that match the SKUs in those orders
    // (qty/amount are the table's real column names). branch_item_price_id
    // rides along for the restore snapshot; a database without that column
    // still removes and restores the lines.
    const { data: linesToRemove, error: lErr } = await selectWithOptionalColumn(
      'id, order_id, item_id, branch_item_price_id, qty, unit_price, amount',
      'branch_item_price_id',
      (cols) => supabase.from('order_lines').select(cols).in('order_id', orderIds).in('item_id', itemIds)
    )

    if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })

    // Per-SKU tally of what this run takes out, so the dialog can say how many
    // lines each pasted SKU costs and flag the ones that are retired.
    const skuMetaByItemId = new Map(
      (items || []).map((i) => [i.item_id, { sku: i.sku, retired: i.is_active === false }])
    )
    const summaryBySku = new Map()
    for (const line of linesToRemove || []) {
      const meta = skuMetaByItemId.get(line.item_id)
      if (!meta) continue
      let entry = summaryBySku.get(meta.sku)
      if (!entry) {
        entry = { sku: meta.sku, retired: meta.retired, lines: 0, orders: new Set(), qty: 0, amount: 0 }
        summaryBySku.set(meta.sku, entry)
      }
      entry.lines += 1
      entry.orders.add(line.order_id)
      entry.qty += Number(line.qty || 0)
      entry.amount += Number(line.amount || 0)
    }
    const itemSummary = [...summaryBySku.values()].map((e) => ({
      sku: e.sku,
      retired: e.retired,
      lines: e.lines,
      orders: e.orders.size,
      qty: e.qty,
      amount: e.amount,
    }))
    const retiredItems = itemSummary.filter((i) => i.retired)

    if (!linesToRemove || linesToRemove.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No matching order lines found for the selected items',
        affected_orders: 0,
        removed_lines: 0,
        item_summary: [],
        retired_items: [],
        missing_skus: missingSkus,
      })
    }

    const affectedOrderIds = [...new Set(linesToRemove.map((l) => l.order_id))]

    // Preview mode: report exactly what a real run would remove, without
    // deleting anything. The confirmation dialog calls this first so the admin
    // sees the branch/cycle scope and the order count before anything is lost.
    if (body.preview) {
      const previewOrderIds = [...new Set(linesToRemove.map((l) => l.order_id))]
      const { data: allLines, error: allErr } = await supabase
        .from('order_lines')
        .select('id, order_id')
        .in('order_id', previewOrderIds)
      if (allErr) return NextResponse.json({ ok: false, error: allErr.message }, { status: 500 })

      const totalByOrder = new Map()
      for (const l of allLines || []) {
        totalByOrder.set(l.order_id, (totalByOrder.get(l.order_id) || 0) + 1)
      }
      const removingByOrder = new Map()
      for (const l of linesToRemove) {
        removingByOrder.set(l.order_id, (removingByOrder.get(l.order_id) || 0) + 1)
      }
      const ordersCancelled = previewOrderIds.filter(
        (id) => (removingByOrder.get(id) || 0) >= (totalByOrder.get(id) || 0)
      ).length

      return NextResponse.json({
        ok: true,
        preview: true,
        affected_orders: previewOrderIds.length,
        removed_lines: linesToRemove.length,
        orders_cancelled: ordersCancelled,
        removed_details: linesToRemove.map((l) => ({
          order_id: l.order_id,
          item_id: l.item_id,
          quantity: l.qty,
          line_total: l.amount,
        })),
        item_summary: itemSummary,
        retired_items: retiredItems,
        missing_skus: missingSkus,
      })
    }

    // 5a. Snapshot first: the delete below has no undo of its own, so keep the
    // exact rows and the order state they came from. Restoring is a later POST
    // to .../restore with the returned snapshot_id. A database that has not run
    // migrations/add-order-removal-snapshots.sql still gets the removal, with
    // a warning in `errors`.
    const errors = []
    let snapshotId = null
    try {
      const insertSnapshot = supabase.from('order_removal_snapshots')?.insert
      if (typeof insertSnapshot === 'function') {
        const orderState = orders
          .filter((o) => affectedOrderIds.includes(o.order_id))
          .map((o) => ({
            order_id: o.order_id,
            status: o.status,
            total_amount: Number(o.total_amount || 0),
            payment_option: o.payment_option,
            cycle_id: o.cycle_id ?? cycleId,
          }))
        const { data: snapRow, error: snapErr } = await supabase
          .from('order_removal_snapshots')
          .insert({
            module: 'food',
            actor,
            branch_code: branchCode,
            branch_id: branchId,
            cycle_id: cycleId,
            requested_skus: skus,
            item_summary: itemSummary,
            retired_skus: retiredItems,
            removed_lines: linesToRemove.length,
            affected_orders: affectedOrderIds.length,
            payload: { orders: orderState, lines: linesToRemove },
          })
          .select('id')
          .single()
        if (snapErr) errors.push({ order_id: null, error: `Snapshot: ${snapErr.message}` })
        else snapshotId = snapRow?.id ?? null
      }
    } catch (e) {
      errors.push({ order_id: null, error: `Snapshot: ${e.message || 'insert failed'}` })
    }

    // 5. Delete the matching order_lines
    const lineIds = linesToRemove.map((l) => l.id)
    const { error: delErr } = await supabase
      .from('order_lines')
      .delete()
      .in('id', lineIds)

    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    // 6. Recalculate totals for affected orders.
    // order_lines.amount already includes the branch markup (same convention
    // as the repricer), so the base total is the SUM of the remaining lines.
    // Loan orders keep their interest: base + ROUND(base × rate%), with the
    // rate from the cycle (default 13% — same fallback the repricer uses).
    let ratePct = 13
    const anyLoan = orders.some((o) => o.payment_option === 'Loan')
    const loanRatePctByCycle = new Map()
    if (anyLoan) {
      for (const o of orders.filter((x) => x.payment_option === 'Loan')) {
        const cid = o.cycle_id ?? cycleId
        if (cid != null && !loanRatePctByCycle.has(cid)) loanRatePctByCycle.set(cid, null)
      }
      for (const cid of loanRatePctByCycle.keys()) {
        try {
          const { data: rRow, error: rErr } = await supabase
            .from('cycles')
            .select('food_loan_interest_rate_pct')
            .eq('id', cid)
            .maybeSingle()
          if (!rErr && rRow && rRow.food_loan_interest_rate_pct != null) {
            loanRatePctByCycle.set(cid, Math.max(0, Number(rRow.food_loan_interest_rate_pct || 0)))
          }
        } catch {}
      }
    }

    const changes = []

    for (const orderId of affectedOrderIds) {
      const orderRow = orders.find((o) => o.order_id === orderId)

      // Get remaining lines for this order. qty rides along because total_qty is
      // what the order list shows as "Items", so it has to follow the lines.
      const { data: remainingLines } = await supabase
        .from('order_lines')
        .select('qty, amount')
        .eq('order_id', orderId)

      const baseTotal = (remainingLines || []).reduce((sum, l) => sum + Number(l.amount || 0), 0)
      const remainingQty = (remainingLines || []).reduce((sum, l) => sum + Number(l.qty || 0), 0)
      const removed = linesToRemove.filter((l) => l.order_id === orderId)
      const change = {
        orderId,
        orderRow,
        removed,
        removedQty: removed.reduce((sum, l) => sum + Number(l.qty || 0), 0),
        removedAmount: removed.reduce((sum, l) => sum + Number(l.amount || 0), 0),
        previousTotal: Number(orderRow?.total_amount || 0),
        newTotal: 0,
        remainingQty,
        cancelled: false,
      }

      if (!remainingLines || remainingLines.length === 0) {
        // Order has no more items — cancel it and zero its item count
        const { error: cancelErr } = await supabase
          .from('orders')
          .update({ status: 'Cancelled', total_amount: 0, total_qty: 0, updated_at: new Date().toISOString() })
          .eq('order_id', orderId)
        if (cancelErr) errors.push({ order_id: orderId, error: cancelErr.message })
        change.cancelled = true
      } else {
        const isLoan = orderRow?.payment_option === 'Loan'
        let newTotal = baseTotal
        if (isLoan) {
          const cid = orderRow?.cycle_id ?? cycleId
          const pct = (cid != null && loanRatePctByCycle.get(cid) != null ? loanRatePctByCycle.get(cid) : ratePct)
          ratePct = Math.max(0, Number(pct || 0))
          newTotal = baseTotal + Math.round(baseTotal * (ratePct / 100))
        }
        // Update the order total and the item count left on it
        const roundedTotal = Math.round(newTotal * 100) / 100
        change.newTotal = roundedTotal
        const { error: updateErr } = await supabase
          .from('orders')
          .update({ total_amount: roundedTotal, total_qty: remainingQty, updated_at: new Date().toISOString() })
          .eq('order_id', orderId)
        if (updateErr) errors.push({ order_id: orderId, error: updateErr.message })
      }

      changes.push(change)
    }

    // Audit trail: one row per affected order so the food audit log answers
    // "who removed which SKUs, and when" for every order touched. Best-effort —
    // the lines are already deleted, so a failing insert lands in `errors`
    // rather than failing the whole run.
    const skuByItemId = new Map((items || []).map((i) => [i.item_id, i.sku]))
    const money = (v) => `₦${Math.round(Number(v || 0)).toLocaleString('en-NG')}`
    for (const c of changes) {
      const skusForOrder = [...new Set(c.removed.map((l) => skuByItemId.get(l.item_id)).filter(Boolean))]
      const skuText = skusForOrder.length ? skusForOrder.join(', ') : 'items'
      const removalText = `Removed ${skuText} (${c.removedQty} unit${c.removedQty === 1 ? '' : 's'}, ${money(c.removedAmount)})`
      const note = c.cancelled
        ? `${removalText} — order cancelled, no items left (was ${money(c.previousTotal)})`
        : `${removalText} — total ${money(c.previousTotal)} → ${money(c.newTotal)}`

      let auditErr = null
      try {
        const { error: insertErr } = await supabase.from('audit_log').insert({
          module: 'food',
          actor,
          action: 'remove_items',
          order_id: String(c.orderId),
          cycle_id: c.orderRow?.cycle_id ?? cycleId,
          delivery_branch_id: c.orderRow?.delivery_branch_id ?? branchId,
          detail: {
            note,
            skus: skusForOrder,
            removed_lines: c.removed.length,
            removed_qty: c.removedQty,
            removed_amount: c.removedAmount,
            previous_total: c.previousTotal,
            new_total: c.cancelled ? 0 : c.newTotal,
            new_total_qty: c.cancelled ? 0 : c.remainingQty,
            order_cancelled: c.cancelled,
            branch_code: branchCode,
            cycle_id: cycleId,
            requested_skus: skus,
          },
        })
        auditErr = insertErr || null
      } catch (e) {
        auditErr = e
      }
      if (auditErr) errors.push({ order_id: c.orderId, error: `Audit log: ${auditErr.message || 'insert failed'}` })
    }

    return NextResponse.json({
      ok: true,
      message: `Removed ${linesToRemove.length} item(s) from ${affectedOrderIds.length} order(s)`,
      affected_orders: affectedOrderIds.length,
      removed_lines: linesToRemove.length,
      snapshot_id: snapshotId,
      removed_details: linesToRemove.map((l) => ({
        order_id: l.order_id,
        item_id: l.item_id,
        quantity: l.qty,
        line_total: l.amount,
      })),
      item_summary: itemSummary,
      retired_items: retiredItems,
      missing_skus: missingSkus,
      errors,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to bulk update' }, { status: 500 })
  }
}
