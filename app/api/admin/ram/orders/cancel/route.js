import { NextResponse } from 'next/server'
import { validateSession, validateNumber } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { logOrderAudit } from '@/lib/orderAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

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
    const adminId = String(body.adminId || body.admin_id || '').trim() || 'admin'
    const idsRaw = asIdArray(body.ids ?? body.id)
    const ids = idsRaw
      .map((v) => validateNumber(v, { min: 1, integer: true }))
      .filter((r) => r.isValid)
      .map((r) => r.value)

    if (!ids.length) return NextResponse.json({ ok: false, error: 'Invalid order id(s)' }, { status: 400 })

    const reason = String(body.reason || '').trim()
    const supabase = createClient()

    const { data: rows, error: selErr } = await supabase.from('ram_orders').select('id,status').in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const missing = ids.filter((id) => !byId.has(id))
    if (missing.length) {
      return NextResponse.json({ ok: false, error: `Order(s) not found: ${missing.join(', ')}` }, { status: 404 })
    }

    const toCancel = ids.filter((id) => String(byId.get(id)?.status || '') === 'Pending')
    const failed = ids
      .filter((id) => !toCancel.includes(id))
      .map((id) => ({ id, status: String(byId.get(id)?.status || '') }))

    if (!toCancel.length) {
      return NextResponse.json({ ok: true, cancelled: [], failed })
    }

    const [hasCancelledAt, hasCancelledReason, hasUpdatedAt] = await Promise.all([
      hasColumn(supabase, 'ram_orders', 'cancelled_at').catch(() => false),
      hasColumn(supabase, 'ram_orders', 'cancelled_reason').catch(() => false),
      hasColumn(supabase, 'ram_orders', 'updated_at').catch(() => false),
    ])

    const updates = { status: 'Cancelled' }
    const now = new Date().toISOString()
    if (hasCancelledAt) updates.cancelled_at = now
    if (hasCancelledReason && reason) updates.cancelled_reason = reason
    if (hasUpdatedAt) updates.updated_at = now

    const { error: upErr } = await supabase.from('ram_orders').update(updates).in('id', toCancel).eq('status', 'Pending')
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    // Audit (food pattern) — record the cancellation with its reason.
    await logOrderAudit(
      supabase,
      toCancel.map((id) => ({ actor: adminId, action: 'cancel', order_id: String(id), detail: reason ? { reason } : {} })),
      'ram'
    )

    return NextResponse.json({ ok: true, cancelled: toCancel, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
