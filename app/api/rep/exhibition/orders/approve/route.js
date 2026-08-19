// app/api/rep/exhibition/orders/approve/route.js
// Approve pending exhibition orders at the rep's branch. Body: { ids: [...] }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { closedCycleIds } from '@/lib/exhibitionCycleGuard'
import { buildRepFailed } from '@/lib/exhibitionFailed'
import { checkOrdersStock } from '@/lib/exhibitionStock'
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
    // must not be approved.
    const closed = await closedCycleIds(supabase, (rows || []).map((r) => r.cycle_id))
    const toApprove = scoped.filter(
      (id) => String(byId.get(id)?.status || '') === 'Pending' && !closed.has(Number(byId.get(id)?.cycle_id))
    )
    const failed = buildRepFailed(ids, byId, auth.branchId, closed, new Set(toApprove))
    if (!toApprove.length) {
      if (failed.length > 0 && failed.every((f) => f.reason === 'Closed exhibition cycle')) {
        return NextResponse.json(
          { ok: false, error: 'Cannot approve: this order belongs to a closed exhibition cycle.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ ok: true, approved: [], failed })
    }

    // Approval-time stock gate — the second line of defense behind checkout's
    // reserve. Orders whose reservation has been invalidated (stock driven
    // below zero or the product archived) stay Pending and are reported.
    const { failed: stockFailed } = await checkOrdersStock(supabase, toApprove)
    const stockBlocked = new Set(stockFailed.map((f) => f.id))
    const toApproveFinal = toApprove.filter((id) => !stockBlocked.has(id))
    const failedFinal = [...failed, ...stockFailed]
    if (!toApproveFinal.length) {
      return NextResponse.json({ ok: true, approved: [], failed: failedFinal })
    }

    const now = new Date().toISOString()
    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update({ status: 'Approved', approved_at: now, updated_at: now })
      .in('id', toApproveFinal)
      .eq('status', 'Pending')
      .eq('branch_id', auth.branchId)
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toApproveFinal, {
      action: 'Approved',
      actorType: 'rep',
      actorLabel: `Branch rep · ${auth.claim.branch_code || ''}`,
    })

    return NextResponse.json({ ok: true, approved: toApproveFinal, failed: failedFinal })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
