// app/api/rep/exhibition/orders/deliver/route.js
// The rep's one exhibition action: mark APPROVED orders as delivered at their
// own branch. Body: { ids: [...] }
// Delivering stamps every line, flips the order to Delivered and writes an
// audit entry naming the rep. Approving, cancelling and restoring stay with
// the admin.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
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
      .select('id, status, branch_id')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))

    // Branch scoping is enforced here, not trusted from the client.
    const toDeliver = ids.filter(
      (id) => Number(byId.get(id)?.branch_id) === auth.branchId && String(byId.get(id)?.status || '') === 'Approved'
    )
    const failed = ids
      .filter((id) => !toDeliver.includes(id))
      .map((id) => {
        const row = byId.get(id)
        if (!row) return { id, reason: 'Order not found' }
        if (Number(row.branch_id) !== auth.branchId) return { id, reason: 'Not in your branch' }
        return { id, status: String(row.status || '') }
      })
    if (!toDeliver.length) return NextResponse.json({ ok: true, delivered: [], failed })

    const now = new Date().toISOString()

    // Every line first, then the order — an order is only Delivered once all
    // of its lines are.
    const { error: lineErr } = await supabase
      .from('exhibition_order_lines')
      .update({ delivered: true, delivered_at: now })
      .in('order_id', toDeliver)
      .eq('delivered', false)
    if (lineErr) return NextResponse.json({ ok: false, error: lineErr.message }, { status: 500 })

    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update({ status: 'Delivered', delivered_at: now, updated_at: now })
      .in('id', toDeliver)
      .eq('status', 'Approved')
      .eq('branch_id', auth.branchId)
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toDeliver, {
      action: 'Delivered',
      actorType: 'rep',
      actorLabel: `Branch rep · ${auth.claim.branch_code || ''}`,
    })

    return NextResponse.json({ ok: true, delivered: toDeliver, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
