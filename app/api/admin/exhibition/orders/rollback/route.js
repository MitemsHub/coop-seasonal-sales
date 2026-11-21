// app/api/admin/exhibition/orders/rollback/route.js
// Move an exhibition order back one stage. Body: { ids, reason }
//   Confirmed → Approved   (confirmed by mistake, goods returned)
//   Approved  → Pending    (approved by mistake, member not cleared)
//
// Confirmed is what feeds vendor payouts, so rolling it back is the correction
// path for an order that was closed by mistake. The confirmation stamps are
// cleared so the order carries the same audit shape as any other Approved
// order, and it reappears on the Approved page for the member to confirm again.
// Rolling Approved back to Pending also withdraws the "ready for pickup"
// notification and clears approved_at/ready_at, so nothing tells the member to
// collect an order that is no longer approved.
//
// An order whose vendor payout rows are already marked paid is refused: the
// money has left the co-op, so the payout must be unmarked first.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { validateSession, validateNumber, sanitizeString } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// One step back per stage; anything else is left alone.
const ROLLBACK_FROM_TO = { Confirmed: 'Approved', Approved: 'Pending' }

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

    const reason = sanitizeString(body.reason || '', { maxLength: 300, encodeHtml: false })
    const supabase = createClient()

    const { data: rows, error: selErr } = await supabase
      .from('exhibition_orders')
      .select('id, order_id, status')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const rollbackIds = ids.filter((id) => ROLLBACK_FROM_TO[String(byId.get(id)?.status || '')])

    // Only Approved or Confirmed orders can be rolled back. Everything else is
    // reported back so the desk knows which rows were left alone.
    const failed = ids
      .filter((id) => !rollbackIds.includes(id))
      .map((id) => ({ id, status: String(byId.get(id)?.status || ''), reason: 'Only approved or confirmed orders can be rolled back' }))
    if (!rollbackIds.length) return NextResponse.json({ ok: true, rolledBack: [], failed })

    // A paid vendor payout must be unmarked before the order stops counting
    // towards it. If the table is missing (older deployment) the check is skipped.
    const paidIds = new Set()
    const { data: paidRows, error: payErr } = await supabase
      .from('exhibition_vendor_payment_status')
      .select('order_id, paid')
      .in('order_id', rollbackIds)
      .eq('paid', true)
    if (!payErr) {
      for (const p of paidRows || []) paidIds.add(Number(p.order_id))
    }

    const toRollback = rollbackIds.filter((id) => !paidIds.has(id))
    for (const id of rollbackIds.filter((id) => paidIds.has(id))) {
      failed.push({ id, status: String(byId.get(id)?.status || ''), reason: 'Vendor payout already marked paid' })
    }
    if (!toRollback.length) {
      const allPaid = rollbackIds.every((id) => paidIds.has(id))
      if (allPaid) {
        return NextResponse.json(
          { ok: false, error: 'Cannot roll back: the vendor payout for this order is already marked paid. Unmark the payout first.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ ok: true, rolledBack: [], failed })
    }

    const now = new Date().toISOString()
    const toPending = toRollback.filter((id) => ROLLBACK_FROM_TO[String(byId.get(id)?.status || '')] === 'Pending')
    const toApproved = toRollback.filter((id) => !toPending.includes(id))

    // Confirmed → Approved keeps its approved/ready timestamps: it is still an
    // approved order waiting on the member.
    if (toApproved.length) {
      const { error: upErr } = await supabase
        .from('exhibition_orders')
        .update({
          status: 'Approved',
          member_confirmed_at: null,
          member_confirmed_by: '',
          confirmed_by_role: '',
          confirmed_by_code: '',
          delivered_at: null,
          updated_at: now,
        })
        .in('id', toApproved)
        .eq('status', 'Confirmed')
      if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })
    }

    // Approved → Pending puts the order back in the decision queue, so the
    // approval stamps go too.
    if (toPending.length) {
      const { error: upErr } = await supabase
        .from('exhibition_orders')
        .update({
          status: 'Pending',
          approved_at: null,
          ready_at: null,
          member_confirmed_at: null,
          member_confirmed_by: '',
          confirmed_by_role: '',
          confirmed_by_code: '',
          delivered_at: null,
          updated_at: now,
        })
        .in('id', toPending)
        .eq('status', 'Approved')
      if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

      // Approval told the member the order was ready; a pending order must not
      // keep saying that. Best-effort — the status change already stands.
      try {
        const orderIds = toPending.map((id) => String(byId.get(id)?.order_id || '')).filter(Boolean)
        if (orderIds.length) {
          await supabase
            .from('member_notifications')
            .delete()
            .eq('module', 'exhibition')
            .eq('event', 'ready')
            .in('order_id', orderIds)
        }
      } catch {
        // Never fail the rollback because a notification could not be removed.
      }
    }

    await logExhibitionAudit(toRollback, {
      action: 'Rolled back',
      actorType: 'admin',
      actorLabel: 'System admin',
      note:
        reason ||
        (toPending.length
          ? 'Approved order rolled back to Pending at the admin desk'
          : 'Confirmed order rolled back to Approved at the admin desk'),
    })

    return NextResponse.json({ ok: true, rolledBack: toRollback, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
