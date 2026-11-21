// app/api/admin/exhibition/orders/rollback/route.js
// Roll a Confirmed exhibition order back to Approved. Body: { ids, reason }
//
// Confirmed is what feeds vendor payouts, so this is the correction path for an
// order that was closed by mistake (wrong order confirmed at the desk, member
// confirmed then returned the goods). The confirmation stamps are cleared so
// the order carries the same audit shape as any other Approved order, and it
// reappears on the Approved page for the member to confirm again.
//
// An order whose vendor payout rows are already marked paid is refused: the
// money has left the co-op, so the payout must be unmarked first.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { validateSession, validateNumber, sanitizeString } from '@/lib/validation'

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

    const reason = sanitizeString(body.reason || '', { maxLength: 300, encodeHtml: false })
    const supabase = createClient()

    const { data: rows, error: selErr } = await supabase
      .from('exhibition_orders')
      .select('id, order_id, status')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const confirmedIds = ids.filter((id) => String(byId.get(id)?.status || '') === 'Confirmed')

    // Only Confirmed orders can be rolled back. Everything else is reported
    // back so the desk knows which rows were left alone.
    const failed = ids
      .filter((id) => !confirmedIds.includes(id))
      .map((id) => ({ id, status: String(byId.get(id)?.status || ''), reason: 'Only confirmed orders can be rolled back' }))
    if (!confirmedIds.length) return NextResponse.json({ ok: true, rolledBack: [], failed })

    // A paid vendor payout must be unmarked before the order stops counting
    // towards it. If the table is missing (older deployment) the check is skipped.
    const paidIds = new Set()
    const { data: paidRows, error: payErr } = await supabase
      .from('exhibition_vendor_payment_status')
      .select('order_id, paid')
      .in('order_id', confirmedIds)
      .eq('paid', true)
    if (!payErr) {
      for (const p of paidRows || []) paidIds.add(Number(p.order_id))
    }

    const toRollback = confirmedIds.filter((id) => !paidIds.has(id))
    for (const id of confirmedIds.filter((id) => paidIds.has(id))) {
      failed.push({ id, status: 'Confirmed', reason: 'Vendor payout already marked paid' })
    }
    if (!toRollback.length) {
      const allPaid = confirmedIds.every((id) => paidIds.has(id))
      if (allPaid) {
        return NextResponse.json(
          { ok: false, error: 'Cannot roll back: the vendor payout for this order is already marked paid. Unmark the payout first.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ ok: true, rolledBack: [], failed })
    }

    const now = new Date().toISOString()
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
      .in('id', toRollback)
      .eq('status', 'Confirmed')
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toRollback, {
      action: 'Rolled back',
      actorType: 'admin',
      actorLabel: 'System admin',
      note: reason || 'Confirmed order rolled back to Approved at the admin desk',
    })

    return NextResponse.json({ ok: true, rolledBack: toRollback, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
