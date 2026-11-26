// app/api/admin/exhibition/orders/restore/route.js
// Restore cancelled exhibition orders back to Pending. Body: { ids }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { closedCycleIds } from '@/lib/exhibitionCycleGuard'
import { validateSession, validateNumber } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asIdArray(input) {
  if (Array.isArray(input)) return input
  if (input == null) return []
  return [input]
}

export async function POST(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const ids = asIdArray(body.ids ?? body.id)
      .map((v) => validateNumber(v, { min: 1, integer: true }))
      .filter((r) => r.isValid)
      .map((r) => r.value)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'Invalid order id(s)' }, { status: 400 })

    const supabase = createClient()
    const { data: rows, error: selErr } = await supabase.from('exhibition_orders').select('id, status, cycle_id').in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))

    // Gate on the order's cycle still being active — closed-cycle orders
    // must not be restored.
    const closed = await closedCycleIds(supabase, (rows || []).map((r) => r.cycle_id))
    const cycleOk = ids.filter(
      (id) => String(byId.get(id)?.status || '') === 'Cancelled' && !closed.has(Number(byId.get(id)?.cycle_id))
    )

    // A vendor can withdraw every item it put on an order, which cancels the
    // order itself. Nothing is left to restore in that case — restoring would
    // put an empty order back in the approval queue.
    const { data: lineRows } = await supabase
      .from('exhibition_order_lines')
      .select('order_id')
      .in('order_id', cycleOk)
    const lineCountByOrder = new Map()
    for (const l of lineRows || []) {
      const oid = Number(l.order_id)
      lineCountByOrder.set(oid, (lineCountByOrder.get(oid) || 0) + 1)
    }
    const emptyIds = cycleOk.filter((id) => !(lineCountByOrder.get(Number(id)) || 0))

    // Shop-originated lines need their reserved units back before the order
    // can return to Pending. Manual invoice lines have no product_id.
    const { data: reservedLines } = await supabase
      .from('exhibition_order_lines')
      .select('order_id, product_id, qty')
      .in('order_id', cycleOk)
      .not('product_id', 'is', null)
    const reserveByProduct = new Map()
    for (const line of reservedLines || []) {
      const pid = Number(line.product_id)
      const qty = Number(line.qty || 0)
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue
      reserveByProduct.set(pid, (reserveByProduct.get(pid) || 0) + qty)
    }
    if (reserveByProduct.size) {
      const { error: reserveErr } = await supabase.rpc('exhibition_reserve_stock', {
        p_items: [...reserveByProduct.entries()].map(([product_id, qty]) => ({ product_id, qty })),
      })
      if (reserveErr) {
        return NextResponse.json(
          { ok: false, error: 'Not enough stock to restore this order. Cancel or reduce another order first.' },
          { status: 409 }
        )
      }
    }

    const toRestore = cycleOk.filter((id) => !emptyIds.includes(id))

    const failed = ids
      .filter((id) => !toRestore.includes(id))
      .map((id) => {
        const row = byId.get(id)
        const closedCycle = !!row && closed.has(Number(row.cycle_id))
        const entry = { id, status: String(row?.status || '') }
        if (closedCycle) entry.reason = 'Closed exhibition cycle'
        else if (emptyIds.includes(id)) entry.reason = 'No items left on the order'
        return entry
      })
    if (!toRestore.length) {
      const allClosed = failed.length > 0 && failed.every((f) => f.reason === 'Closed exhibition cycle')
      const allEmpty = failed.length > 0 && failed.every((f) => f.reason === 'No items left on the order')
      if (allClosed) {
        return NextResponse.json(
          { ok: false, error: 'Cannot restore: this order belongs to a closed exhibition cycle.' },
          { status: 409 }
        )
      }
      if (allEmpty) {
        return NextResponse.json(
          { ok: false, error: 'Cannot restore: every item on this order was cancelled, so there is nothing left to restore.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ ok: true, restored: [], failed })
    }

    const now = new Date().toISOString()
    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update({ status: 'Pending', approved_at: null, delivered_at: null, member_confirmed_at: null, member_confirmed_by: '', confirmed_by_role: '', confirmed_by_code: '', cancelled_at: null, cancelled_reason: '', restored_at: now, updated_at: now })
      .in('id', toRestore)
      .eq('status', 'Cancelled')
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toRestore, { action: 'Restored', actorType: 'admin', actorLabel: 'System admin' })

    return NextResponse.json({ ok: true, restored: toRestore, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
