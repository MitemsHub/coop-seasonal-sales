// app/api/admin/markups/bulk-location-update/restore/route.js
// Undo for the bulk item removal tool.
//
// GET  — the last ten removals, newest first, with whether each was restored.
// POST { snapshot_id } — put that run's order lines back, recalculate each
//      order's total/item count, and reopen an order the removal cancelled
//      (only while it is still Cancelled). The snapshot is stamped restored only
//      when every line and every order succeeded; a partial run stays open so
//      the same restore can be retried, and the response names what is left.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { insertWithOptionalField } from '@/lib/optionalColumn'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIST_COLS =
  'id, module, actor, branch_code, cycle_id, requested_skus, item_summary, retired_skus, removed_lines, affected_orders, created_at, restored_at, restored_by'

function isMissingTable(error) {
  const code = String(error?.code || '')
  return code === '42P01' || /order_removal_snapshots/i.test(String(error?.message || ''))
}

// Same fallback the removal route uses: a database without the rate column
// keeps the app-wide default instead of failing the restore.
async function loanRateFor(supabase, cycleId) {
  let rate = 13
  if (cycleId == null) return rate
  try {
    const { data, error } = await supabase
      .from('cycles')
      .select('food_loan_interest_rate_pct')
      .eq('id', cycleId)
      .maybeSingle()
    if (!error && data && data.food_loan_interest_rate_pct != null) {
      rate = Math.max(0, Number(data.food_loan_interest_rate_pct || 0))
    }
  } catch {}
  return rate
}

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('order_removal_snapshots')
      .select(LIST_COLS)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ok: true, snapshots: [], unavailable: true })
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, snapshots: data || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load removals' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const actor = String(session.claims?.email || session.claims?.sub || session.claims?.role || 'admin')

  try {
    const body = await request.json().catch(() => ({}))
    const snapshotId = Math.trunc(Number(body?.snapshot_id || 0))
    if (!Number.isFinite(snapshotId) || snapshotId <= 0) {
      return NextResponse.json({ ok: false, error: 'snapshot_id is required' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: snapshot, error: snapErr } = await supabase
      .from('order_removal_snapshots')
      .select('id, branch_code, cycle_id, requested_skus, payload, created_at, restored_at')
      .eq('id', snapshotId)
      .maybeSingle()

    if (snapErr) {
      if (isMissingTable(snapErr)) {
        return NextResponse.json(
          { ok: false, error: 'Removal snapshots are not set up yet. Run migrations/add-order-removal-snapshots.sql.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: snapErr.message }, { status: 500 })
    }
    if (!snapshot) return NextResponse.json({ ok: false, error: 'Removal not found' }, { status: 404 })
    if (snapshot.restored_at) {
      return NextResponse.json({ ok: false, error: 'This removal has already been restored.' }, { status: 409 })
    }

    const payload = snapshot.payload || {}
    const lines = Array.isArray(payload.lines) ? payload.lines : []
    const orderStates = Array.isArray(payload.orders) ? payload.orders : []
    if (!lines.length) {
      return NextResponse.json({ ok: false, error: 'This removal has no saved lines to restore' }, { status: 400 })
    }

    const errors = []
    const failedLines = []
    const failedOrders = []
    const restoredOrders = []
    const restoredLineIds = []
    let alreadyPresent = 0

    // Put the exact line rows back. The ids are kept so anything that points at
    // a line finds it again; a line that is somehow already back is skipped.
    for (const line of lines) {
      const row = {
        id: line.id,
        order_id: line.order_id,
        item_id: line.item_id,
        unit_price: line.unit_price,
        qty: line.qty,
        amount: line.amount,
      }
      if (line.branch_item_price_id != null) row.branch_item_price_id = line.branch_item_price_id

      // The branch price row may have been replaced since, or the column may
      // not exist on this database; the line still belongs on the order, so the
      // shared helper retries without that reference rather than losing it.
      const inserted = await insertWithOptionalField(row, 'branch_item_price_id', (r) =>
        supabase.from('order_lines').insert(r)
      )
      if (inserted.error) {
        if (String(inserted.error.code || '') === '23505') {
          alreadyPresent += 1
          continue
        }
        const failure = {
          order_id: line.order_id,
          line_id: line.id,
          item_id: line.item_id,
          qty: line.qty,
          error: inserted.error.message,
        }
        failedLines.push(failure)
        errors.push(failure)
        continue
      }
      restoredLineIds.push(line.id)
    }

    // Recalculate each touched order from its lines, exactly like the removal
    // did (Loan orders keep the cycle's interest).
    for (const state of orderStates) {
      const orderId = state.order_id
      if (orderId == null) continue

      const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .select('order_id, status, payment_option, cycle_id, total_amount, total_qty')
        .eq('order_id', orderId)
        .maybeSingle()
      if (orderErr) {
        const failure = { order_id: orderId, error: orderErr.message }
        failedOrders.push(failure)
        errors.push(failure)
        continue
      }

      const { data: remainingLines, error: linesErr } = await supabase
        .from('order_lines')
        .select('qty, amount')
        .eq('order_id', orderId)
      if (linesErr) {
        const failure = { order_id: orderId, error: linesErr.message }
        failedOrders.push(failure)
        errors.push(failure)
        continue
      }

      const base = (remainingLines || []).reduce((sum, l) => sum + Number(l.amount || 0), 0)
      const totalQty = (remainingLines || []).reduce((sum, l) => sum + Number(l.qty || 0), 0)

      let total = base
      if (orderRow?.payment_option === 'Loan') {
        const cycleId = orderRow?.cycle_id ?? state.cycle_id ?? snapshot.cycle_id ?? null
        const rate = await loanRateFor(supabase, cycleId)
        total = base + Math.round(base * (rate / 100))
      }
      const roundedTotal = Math.round(total * 100) / 100

      const patch = {
        total_amount: roundedTotal,
        total_qty: totalQty,
        updated_at: new Date().toISOString(),
      }
      // A removal that took every item cancelled the order. Reopen it only if
      // it is still Cancelled — a later decision on the order wins.
      if (
        orderRow?.status === 'Cancelled' &&
        state.status &&
        state.status !== 'Cancelled'
      ) {
        patch.status = state.status
      }

      const { error: updErr } = await supabase.from('orders').update(patch).eq('order_id', orderId)
      if (updErr) {
        const failure = { order_id: orderId, error: updErr.message }
        failedOrders.push(failure)
        errors.push(failure)
        continue
      }
      restoredOrders.push({
        order_id: orderId,
        status: patch.status || orderRow?.status || '',
        total_amount: roundedTotal,
        total_qty: totalQty,
        cycle_id: orderRow?.cycle_id ?? state.cycle_id ?? snapshot.cycle_id ?? null,
      })
    }

    // The removal is only closed once every line is back and every order was
    // recalculated. A half-restored run keeps restored_at empty so the same
    // snapshot can be retried instead of answering 409 forever.
    const pendingOrderIds = [
      ...new Set([...failedLines.map((f) => f.order_id), ...failedOrders.map((f) => f.order_id)]),
    ].filter((id) => id != null)
    let complete = failedLines.length === 0 && failedOrders.length === 0
    let restoredAt = null
    let markFailure = null

    if (complete) {
      restoredAt = new Date().toISOString()
      const { error: markErr } = await supabase
        .from('order_removal_snapshots')
        .update({ restored_at: restoredAt, restored_by: actor })
        .eq('id', snapshotId)
      if (markErr) {
        complete = false
        restoredAt = null
        markFailure = { order_id: null, error: `Snapshot: ${markErr.message}` }
        errors.push(markFailure)
      }
    }

    const remaining = {
      lines: failedLines.length,
      orders: failedOrders.length,
      order_ids: pendingOrderIds,
      failed_lines: failedLines,
      failed_orders: failedOrders,
      snapshot_mark_failed: Boolean(markFailure),
    }
    const message = complete
      ? `Restored ${restoredLineIds.length} line(s) across ${restoredOrders.length} order(s).`
      : markFailure
        ? 'Every line and order is back, but the removal could not be marked restored. Run Restore again to close it.'
        : `Only part of this removal is back — ${failedLines.length} line(s) and ${failedOrders.length} order(s) still need restoring` +
          (pendingOrderIds.length ? ` (order #${pendingOrderIds.join(', #')})` : '') +
          '. The removal stays open, so running Restore again retries just what is missing.'

    // Audit trail: the food audit log already records removals, so the restore
    // that undoes one belongs there too.
    try {
      for (const order of restoredOrders) {
        await supabase.from('audit_log').insert({
          module: 'food',
          actor,
          action: 'restore_items',
          order_id: String(order.order_id),
          cycle_id: order.cycle_id ?? null,
          detail: {
            note: `Restored items removed in bulk on ${snapshot.created_at ? new Date(snapshot.created_at).toLocaleString('en-GB') : 'an earlier run'}`,
            snapshot_id: snapshotId,
            branch_code: snapshot.branch_code || '',
            order_status: order.status,
            total_amount: order.total_amount,
            total_qty: order.total_qty,
            requested_skus: snapshot.requested_skus || [],
          },
        })
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      snapshot_id: snapshotId,
      complete,
      restored_at: restoredAt,
      restored_lines: restoredLineIds.length,
      restored_orders: restoredOrders,
      already_present: alreadyPresent,
      remaining,
      message,
      errors,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to restore removal' }, { status: 500 })
  }
}
