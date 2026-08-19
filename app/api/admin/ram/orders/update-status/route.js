import { NextResponse } from 'next/server'
import { validateSession, validateNumber } from '@/lib/validation'
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
    const idRes = validateNumber(body.id, { min: 1, integer: true })
    if (!idRes.isValid) return NextResponse.json({ ok: false, error: 'Invalid order id' }, { status: 400 })

    const status = String(body.status || '').trim()
    const allowedStatus = new Set(['Pending', 'Approved', 'Delivered', 'Cancelled'])
    if (!allowedStatus.has(status)) {
      return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('ram_orders')
      .update({ status })
      .eq('id', idRes.value)
      .select('id,status')
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    // Audit (food pattern) — record who made the status change.
    const action = { Approved: 'approve', Cancelled: 'cancel', Delivered: 'deliver', Pending: 'restore' }[data.status]
    if (action) {
      await logOrderAudit(supabase, [
        { actor: adminId, action, order_id: String(data.id), detail: { status } },
      ], 'ram')
    }

    return NextResponse.json({ ok: true, order: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
