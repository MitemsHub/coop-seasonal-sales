import { NextResponse } from 'next/server'
import { validateNumber, validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { logOrderAudit } from '@/lib/orderAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const adminId = String(body.adminId || body.admin_id || '').trim() || 'admin'
    const ids = Array.isArray(body.ids) ? body.ids : []
    const status = String(body.status || '').trim()

    const allowedStatus = new Set(['Pending', 'Approved', 'Delivered', 'Cancelled'])
    if (!allowedStatus.has(status)) {
      return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })
    }

    if (!ids.length) {
      return NextResponse.json({ ok: false, error: 'No order ids provided' }, { status: 400 })
    }

    const parsedIds = []
    for (const raw of ids) {
      const idRes = validateNumber(raw, { min: 1, integer: true })
      if (idRes.isValid) parsedIds.push(idRes.value)
    }

    if (!parsedIds.length) {
      return NextResponse.json({ ok: false, error: 'No valid order ids provided' }, { status: 400 })
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('ram_orders')
      .update({ status })
      .in('id', parsedIds)
      .select('id,status')

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Audit (food pattern) — record who made the status change, per order.
    const action = { Approved: 'approve', Cancelled: 'cancel', Delivered: 'deliver', Pending: 'restore' }[status]
    if (action) {
      await logOrderAudit(
        supabase,
        (data || []).map((r) => ({ actor: adminId, action, order_id: String(r.id), detail: { status } })),
        'ram'
      )
    }

    return NextResponse.json({
      ok: true,
      updated: (data || []).map((r) => ({ id: r.id, status: r.status })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
