// app/api/admin/exhibition/orders/lines/restore/route.js
// POST /api/admin/exhibition/orders/lines/restore
//   body: { order_id (db id), ids?: number[] }   // ids = cancelled-line row ids
//
// Put items a stand withdrew back on the order. Without `ids`, every item still
// off that order comes back. The line goes back with the name, quantity and
// price it was withdrawn at, the stock is reserved again, and the order total,
// its loan interest, the quantities and the stands' payables are recalculated
// in the same transaction (lib/exhibitionOrderLines.js).
//
// An order cancelled in full is restored from the Cancelled queue, not here:
// one item cannot be re-added to an order whose other lines are gone.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAuditEntries } from '@/lib/exhibitionAudit'
import { closedCycleIds } from '@/lib/exhibitionCycleGuard'
import { validateSession, validateNumber } from '@/lib/validation'
import { restoreOrderItems } from '@/lib/exhibitionOrderLines'

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
    const orderId = asIdArray(body.order_id ?? body.id)
      .map((v) => validateNumber(v, { min: 1, integer: true }))
      .filter((r) => r.isValid)
      .map((r) => r.value)[0]
    if (!orderId) return NextResponse.json({ ok: false, error: 'Invalid order id' }, { status: 400 })

    const ids = [...new Set(
      asIdArray(body.ids ?? body.cancel_ids ?? body.line_ids)
        .map((v) => validateNumber(v, { min: 1, integer: true }))
        .filter((r) => r.isValid)
        .map((r) => r.value)
    )]

    const supabase = createClient()
    const { data: order, error: oErr } = await supabase
      .from('exhibition_orders')
      .select('id, status, cycle_id')
      .eq('id', orderId)
      .maybeSingle()
    if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 })
    if (!order) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    const closed = await closedCycleIds(supabase, [order.cycle_id])
    if (closed.has(Number(order.cycle_id))) {
      return NextResponse.json(
        { ok: false, error: 'This order belongs to a closed exhibition cycle; its items can no longer be restored.' },
        { status: 409 }
      )
    }

    const result = await restoreOrderItems({
      orderId,
      cancelIds: ids.length ? ids : null,
      restoreOrder: false,
      actorLabel: 'System admin',
    })
    if (result?.error) {
      return NextResponse.json({ ok: false, ...result }, { status: result.status || 400 })
    }

    const label = result.restored.map((l) => `${l.product_name || 'Item'}${l.qty ? ` × ${l.qty}` : ''}`).join(', ')
    await logExhibitionAuditEntries([
      {
        orderId,
        cycleId: Number(order.cycle_id || 0),
        action: 'Lines restored',
        actorType: 'admin',
        actorLabel: 'System admin',
        note: `${label} back on the order · total NGN ${Number(result.restored_amount || 0).toLocaleString('en-NG')} → ${Number(
          result.order.total_amount || 0
        ).toLocaleString('en-NG')}`,
        detail: {
          order_id: result.order.order_id,
          restored_lines: result.restored,
          restored_qty: result.restored_qty,
          restored_amount: result.restored_amount,
          new_total: result.order.total_amount,
          previous_total: result.order.previous_total_amount,
          applied_interest_rate_pct: result.rate,
        },
      },
    ])

    return NextResponse.json({
      ok: true,
      order: result.order,
      restored: result.restored,
      restored_qty: result.restored_qty,
      restored_amount: result.restored_amount,
    })
  } catch (e) {
    console.error('Admin line restore failed:', e)
    const msg = String(e?.message || '')
    if (msg.includes('EXHIBITION_OVERSELL')) {
      return NextResponse.json(
        { ok: false, error: 'Not enough stock to put that item back. Cancel or reduce another order first.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ ok: false, error: e.message || 'Failed to restore that item' }, { status: 500 })
  }
}
