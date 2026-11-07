// app/api/admin/exhibition/orders/approve/route.js
// Approve pending exhibition orders (admin = superuser; reps also approve
// from their portal). Body: { ids: [...] }
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
    const { data: rows, error: selErr } = await supabase
      .from('exhibition_orders')
      .select('id, order_id, member_id, status, cycle_id')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))

    // Gate on the order's cycle still being active — closed-cycle orders
    // must not be approved.
    const closed = await closedCycleIds(supabase, (rows || []).map((r) => r.cycle_id))
    const toApprove = ids.filter(
      (id) => String(byId.get(id)?.status || '') === 'Pending' && !closed.has(Number(byId.get(id)?.cycle_id))
    )
    const failed = ids
      .filter((id) => !toApprove.includes(id))
      .map((id) => {
        const row = byId.get(id)
        const closedCycle = !!row && closed.has(Number(row.cycle_id))
        return { id, status: String(row?.status || ''), ...(closedCycle ? { reason: 'Closed exhibition cycle' } : {}) }
      })
    if (!toApprove.length) {
      if (failed.length > 0 && failed.every((f) => f.reason)) {
        return NextResponse.json(
          { ok: false, error: 'Cannot approve: this order belongs to a closed exhibition cycle.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ ok: true, approved: [], failed })
    }

    // Counter invoices carry no catalogue stock, so approval is the cycle gate
    // above and nothing else.
    const toApproveFinal = toApprove
    const failedFinal = failed
    if (!toApproveFinal.length) {
      return NextResponse.json({ ok: true, approved: [], failed: failedFinal })
    }

    const now = new Date().toISOString()
    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update({ status: 'Approved', approved_at: now, updated_at: now })
      .in('id', toApproveFinal)
      .eq('status', 'Pending')
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    // An approved order is cleared for collection: stamp the ready time once
    // and tell the member, so "where is my order?" is answered by the order
    // page instead of a phone call.
    const byIdFinal = new Map((rows || []).map((r) => [Number(r.id), r]))
    await supabase
      .from('exhibition_orders')
      .update({ ready_at: now })
      .in('id', toApproveFinal)
      .is('ready_at', null)

    try {
      for (const id of toApproveFinal) {
        const row = byIdFinal.get(Number(id))
        if (!row?.member_id || !row?.order_id) continue
        const memberKey = String(row.member_id).toUpperCase()
        await supabase.from('member_notifications').insert({
          member_id: memberKey,
          module: 'exhibition',
          event: 'ready',
          order_id: String(row.order_id),
          title: 'Ready for pickup',
          message: `Order ${row.order_id} is approved and ready to collect at your branch.`,
          dedupe_key: `${memberKey}:exhibition:${row.order_id}:ready`,
        })
      }
    } catch {
      // A failed notification must never fail the approval.
    }

    await logExhibitionAudit(toApproveFinal, { action: 'Approved', actorType: 'admin', actorLabel: 'System admin' })

    return NextResponse.json({ ok: true, approved: toApproveFinal, failed: failedFinal })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
