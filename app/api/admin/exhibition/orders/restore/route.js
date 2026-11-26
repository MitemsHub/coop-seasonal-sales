// app/api/admin/exhibition/orders/restore/route.js
// Restore cancelled exhibition orders back to Pending. Body: { ids }
//
// A cancellation can leave an order with no lines at all — a vendor withdrew
// every item on it — and it can leave items the admin desk cancelled with their
// lines still attached. Both come back here: the items taken off the order are
// put back from exhibition_cancelled_lines, the stock is reserved again, the
// total and loan interest are recalculated at the rate the order was charged,
// the stands' payables follow, and only then does the order return to Pending.
// The work itself is in lib/exhibitionOrderLines.js so it is one transaction.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
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
    const ids = asIdArray(body.ids ?? body.id)
      .map((v) => validateNumber(v, { min: 1, integer: true }))
      .filter((r) => r.isValid)
      .map((r) => r.value)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'Invalid order id(s)' }, { status: 400 })

    const supabase = createClient()
    const { data: rows, error: selErr } = await supabase
      .from('exhibition_orders')
      .select('id, status, cycle_id')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))

    // Closed-cycle orders must not be restored.
    const closed = await closedCycleIds(supabase, (rows || []).map((r) => r.cycle_id))

    const restored = []
    const failed = []
    for (const id of ids) {
      const row = byId.get(Number(id))
      if (!row) {
        failed.push({ id, status: '', reason: 'Order not found' })
        continue
      }
      if (String(row.status) !== 'Cancelled') {
        failed.push({ id, status: String(row.status || ''), reason: 'Only cancelled orders can be restored' })
        continue
      }
      if (closed.has(Number(row.cycle_id))) {
        failed.push({ id, status: String(row.status || ''), reason: 'Closed exhibition cycle' })
        continue
      }

      const result = await restoreOrderItems({
        orderId: Number(id),
        cancelIds: null,
        restoreOrder: true,
        actorLabel: 'System admin',
      })
      if (result?.error) {
        failed.push({ id, status: String(row.status || ''), reason: result.error })
        continue
      }
      restored.push(id)
    }

    if (!restored.length) {
      const closedOnly = failed.length > 0 && failed.every((f) => f.reason === 'Closed exhibition cycle')
      const emptyOnly = failed.length > 0 && failed.every((f) => /nothing left|no cancelled items/i.test(f.reason))
      if (closedOnly) {
        return NextResponse.json(
          { ok: false, error: 'Cannot restore: this order belongs to a closed exhibition cycle.' },
          { status: 409 }
        )
      }
      if (emptyOnly) {
        return NextResponse.json(
          { ok: false, error: 'Cannot restore: every item on this order was cancelled and none of them can be put back.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ ok: false, error: failed[0]?.reason || 'Nothing could be restored', restored: [], failed })
    }

    await logExhibitionAudit(restored, {
      action: 'Restored',
      actorType: 'admin',
      actorLabel: 'System admin',
      note: 'Order restored to Pending, with the items that had been withdrawn',
    })

    return NextResponse.json({ ok: true, restored, failed })
  } catch (e) {
    console.error('Admin order restore failed:', e)
    const msg = String(e?.message || '')
    if (msg.includes('EXHIBITION_OVERSELL')) {
      return NextResponse.json(
        { ok: false, error: 'Not enough stock to restore this order. Cancel or reduce another order first.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
