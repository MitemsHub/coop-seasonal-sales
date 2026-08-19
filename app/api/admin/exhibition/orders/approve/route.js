// app/api/admin/exhibition/orders/approve/route.js
// Approve pending exhibition orders (admin = superuser; reps also approve
// from their portal). Body: { ids: [...] }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { closedCycleIds } from '@/lib/exhibitionCycleGuard'
import { checkOrdersStock } from '@/lib/exhibitionStock'
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
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toApproveFinal, { action: 'Approved', actorType: 'admin', actorLabel: 'System admin' })

    return NextResponse.json({ ok: true, approved: toApproveFinal, failed: failedFinal })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
