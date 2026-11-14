// app/api/admin/exhibition/orders/cancel/route.js
// Cancel exhibition orders (Pending or Approved). Body: { ids, reason }
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
    const { data: rows, error: selErr } = await supabase.from('exhibition_orders').select('id, status').in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const toCancel = ids.filter((id) => ['Pending', 'Approved'].includes(String(byId.get(id)?.status || '')))
    const failed = ids.filter((id) => !toCancel.includes(id)).map((id) => ({ id, status: String(byId.get(id)?.status || '') }))
    if (!toCancel.length) return NextResponse.json({ ok: true, cancelled: [], failed })

    const now = new Date().toISOString()
    const updates = { status: 'Cancelled', cancelled_at: now, restored_at: null, updated_at: now }
    if (reason) updates.cancelled_reason = reason

    // Shop-originated lines reserved stock at checkout. Put those units back
    // before the cancellation is considered complete; manual invoice lines
    // have no product_id and are ignored.
    const { data: reservedLines } = await supabase
      .from('exhibition_order_lines')
      .select('product_id, qty')
      .in('order_id', toCancel)
      .not('product_id', 'is', null)
    const releaseByProduct = new Map()
    for (const line of reservedLines || []) {
      const pid = Number(line.product_id)
      const qty = Number(line.qty || 0)
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue
      releaseByProduct.set(pid, (releaseByProduct.get(pid) || 0) + qty)
    }

    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update(updates)
      .in('id', toCancel)
      .in('status', ['Pending', 'Approved'])
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    let stockReleaseWarning = ''
    if (releaseByProduct.size) {
      const { error: releaseErr } = await supabase.rpc('exhibition_release_stock', {
        p_items: [...releaseByProduct.entries()].map(([product_id, qty]) => ({ product_id, qty })),
      })
      if (releaseErr) stockReleaseWarning = releaseErr.message || 'Failed to release stock'
    }

    await logExhibitionAudit(toCancel, {
      action: 'Cancelled',
      actorType: 'admin',
      actorLabel: 'System admin',
      note: reason,
    })

    return NextResponse.json({
      ok: true,
      cancelled: toCancel,
      failed,
      ...(stockReleaseWarning ? { warning: stockReleaseWarning } : {}),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
