// app/api/admin/exhibition/orders/restore/route.js
// Restore cancelled exhibition orders back to Pending. Body: { ids }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { closedCycleIds } from '@/lib/exhibitionCycleGuard'
import { reserveOrdersStock } from '@/lib/exhibitionStock'
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

    // Re-reserve stock before restoring — the cancelled order freed its units
    // and they may have sold on. Orders that can't be covered stay cancelled.
    const { failed: stockFailed } = await reserveOrdersStock(supabase, cycleOk)
    const stockFailedIds = new Set(stockFailed.map((f) => Number(f.id)))
    const toRestore = cycleOk.filter((id) => !stockFailedIds.has(id))

    const failed = ids
      .filter((id) => !toRestore.includes(id))
      .map((id) => {
        const row = byId.get(id)
        const closedCycle = !!row && closed.has(Number(row.cycle_id))
        const entry = { id, status: String(row?.status || '') }
        if (closedCycle) entry.reason = 'Closed exhibition cycle'
        if (stockFailedIds.has(Number(id))) entry.reason = 'Insufficient stock to restore'
        return entry
      })
    if (!toRestore.length) {
      const allClosed = failed.length > 0 && failed.every((f) => f.reason === 'Closed exhibition cycle')
      if (allClosed) {
        return NextResponse.json(
          { ok: false, error: 'Cannot restore: this order belongs to a closed exhibition cycle.' },
          { status: 409 }
        )
      }
      const allStock = failed.length > 0 && failed.every((f) => f.reason === 'Insufficient stock to restore')
      if (allStock) {
        return NextResponse.json(
          { ok: false, error: 'Cannot restore: not enough stock left for the items in this order.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ ok: true, restored: [], failed })
    }

    const now = new Date().toISOString()
    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update({ status: 'Pending', approved_at: null, delivered_at: null, cancelled_at: null, cancelled_reason: '', restored_at: now, updated_at: now })
      .in('id', toRestore)
      .eq('status', 'Cancelled')
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toRestore, { action: 'Restored', actorType: 'admin', actorLabel: 'System admin' })

    return NextResponse.json({ ok: true, restored: toRestore, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
