// app/api/admin/exhibition/orders/cancel/route.js
// Cancel exhibition orders (Pending or Approved). Body: { ids, reason }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { releaseOrdersStock } from '@/lib/exhibitionStock'
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
    const { data: rows, error: selErr } = await supabase.from('exhibition_orders').select('id, status').in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const toCancel = ids.filter((id) => ['Pending', 'Approved'].includes(String(byId.get(id)?.status || '')))
    const failed = ids.filter((id) => !toCancel.includes(id)).map((id) => ({ id, status: String(byId.get(id)?.status || '') }))
    if (!toCancel.length) return NextResponse.json({ ok: true, cancelled: [], failed })

    const now = new Date().toISOString()
    const updates = { status: 'Cancelled', cancelled_at: now, restored_at: null, updated_at: now }
    if (reason) updates.cancelled_reason = reason

    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update(updates)
      .in('id', toCancel)
      .in('status', ['Pending', 'Approved'])
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    // Return reserved stock to the shelf — cancelled orders free their units.
    await releaseOrdersStock(supabase, toCancel)

    await logExhibitionAudit(toCancel, {
      action: 'Cancelled',
      actorType: 'admin',
      actorLabel: 'System admin',
      note: reason,
    })

    return NextResponse.json({ ok: true, cancelled: toCancel, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
