// app/api/rep/exhibition/orders/restore/route.js
// Restore cancelled exhibition orders back to Pending at the rep's branch.
// Body: { ids }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { closedCycleIds } from '@/lib/exhibitionCycleGuard'
import { reserveOrdersStock } from '@/lib/exhibitionStock'
import { buildRepFailed } from '@/lib/exhibitionFailed'
import { getRepBranch } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asIdArray(input) {
  if (Array.isArray(input)) return input
  if (input == null) return []
  return [input]
}

export async function POST(req) {
  try {
    const auth = getRepBranch(req)
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

    const body = await req.json().catch(() => ({}))
    const ids = asIdArray(body.ids ?? body.id)
      .map((v) => Math.trunc(Number(v)))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'Invalid order id(s)' }, { status: 400 })

    const supabase = createClient()
    const { data: rows, error: selErr } = await supabase
      .from('exhibition_orders')
      .select('id, status, branch_id, cycle_id')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const scoped = ids.filter((id) => Number(byId.get(id)?.branch_id) === auth.branchId)

    // Gate on the order's cycle still being active — closed-cycle orders
    // must not be restored.
    const closed = await closedCycleIds(supabase, (rows || []).map((r) => r.cycle_id))
    const cycleOk = scoped.filter(
      (id) => String(byId.get(id)?.status || '') === 'Cancelled' && !closed.has(Number(byId.get(id)?.cycle_id))
    )

    // Re-reserve stock before restoring — the cancelled order freed its units
    // and they may have sold on. Orders that can't be covered stay cancelled.
    const { failed: stockFailed } = await reserveOrdersStock(supabase, cycleOk)
    const stockFailedIds = new Set(stockFailed.map((f) => Number(f.id)))
    const toRestore = cycleOk.filter((id) => !stockFailedIds.has(id))

    const failed = buildRepFailed(ids, byId, auth.branchId, closed, new Set(toRestore))
    for (const f of stockFailed) {
      const entry = failed.find((x) => Number(x.id) === Number(f.id))
      if (entry) entry.reason = 'Insufficient stock to restore'
      else failed.push({ id: f.id, status: 'Cancelled', reason: 'Insufficient stock to restore' })
    }
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
      .eq('branch_id', auth.branchId)
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toRestore, {
      action: 'Restored',
      actorType: 'rep',
      actorLabel: `Branch rep · ${auth.claim.branch_code || ''}`,
    })

    return NextResponse.json({ ok: true, restored: toRestore, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
