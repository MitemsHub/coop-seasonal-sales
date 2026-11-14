// app/api/admin/exhibition/orders/confirm/route.js
// Admin override for the final step: confirm receipt on behalf of a member
// when the member cannot use the portal. Body: { ids: [...] }
//
// Only Approved orders can be confirmed. The member confirmation fields are
// stamped so the order still carries the same audit shape as a member tap.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
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
      .select('id, order_id, status, member_id')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const toConfirm = ids.filter((id) => String(byId.get(id)?.status || '') === 'Approved')
    const failed = ids
      .filter((id) => !toConfirm.includes(id))
      .map((id) => ({ id, status: String(byId.get(id)?.status || '') }))
    if (!toConfirm.length) return NextResponse.json({ ok: true, confirmed: [], failed })

    const now = new Date().toISOString()
    const actor = String(session.claims?.email || session.claims?.sub || 'admin')
    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update({
        status: 'Confirmed',
        member_confirmed_at: now,
        member_confirmed_by: String(session.claims?.member_id || 'ADMIN'),
        confirmed_by_role: 'admin',
        confirmed_by_code: actor,
        delivered_at: now,
        updated_at: now,
      })
      .in('id', toConfirm)
      .eq('status', 'Approved')
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toConfirm, {
      action: 'Confirmed',
      actorType: 'admin',
      actorLabel: 'System admin',
      note: 'Receipt confirmed on behalf of the member at the admin desk',
    })

    return NextResponse.json({ ok: true, confirmed: toConfirm, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to confirm orders' }, { status: 500 })
  }
}
