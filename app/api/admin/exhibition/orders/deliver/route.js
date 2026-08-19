// app/api/admin/exhibition/orders/deliver/route.js
// Mark approved exhibition orders as delivered (admin override — normally the
// vendor hands over line-by-line; this lets the admin close out an order when
// the goods have already left the stand). Body: { ids: [...] }
// Delivering an order marks every line delivered and flips the order to
// Delivered, with an audit entry.
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
    const { data: rows, error: selErr } = await supabase.from('exhibition_orders').select('id, status').in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const toDeliver = ids.filter((id) => String(byId.get(id)?.status || '') === 'Approved')
    const failed = ids
      .filter((id) => !toDeliver.includes(id))
      .map((id) => ({ id, status: String(byId.get(id)?.status || '') }))
    if (!toDeliver.length) return NextResponse.json({ ok: true, delivered: [], failed })

    const now = new Date().toISOString()

    // Mark every line delivered, then flip the order to Delivered.
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
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit(toDeliver, { action: 'Delivered', actorType: 'admin', actorLabel: 'System admin' })

    return NextResponse.json({ ok: true, delivered: toDeliver, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
