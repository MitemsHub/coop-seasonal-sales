import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const body = await req.json().catch(() => ({}))
    const adminId = String(body.adminId || 'admin@coop')
    const note = String(body.note || '')
    const orderIdsRaw = Array.isArray(body.orderIds) ? body.orderIds : body.orderId != null ? [body.orderId] : []
    const orderIds = orderIdsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    const toStatus = String(body.toStatus || '')

    if (!orderIds.length) return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })
    if (toStatus !== 'Pending' && toStatus !== 'Posted') {
      return NextResponse.json({ ok: false, error: 'Invalid toStatus' }, { status: 400 })
    }

    const results = { rolledBack: [], failed: [] }

    for (const orderId of orderIds) {
      const { data: o, error: oErr } = await supabase
        .from('orders')
        .select('order_id, status, cycle_id, delivery_branch_id')
        .eq('order_id', orderId)
        .maybeSingle()

      if (oErr || !o?.order_id) {
        results.failed.push({ order_id: orderId, error: oErr?.message || 'Order not found' })
        continue
      }

      const fromStatus = String(o.status || '')
      const allowed =
        (fromStatus === 'Posted' && toStatus === 'Pending') || (fromStatus === 'Delivered' && toStatus === 'Posted')
      if (!allowed) {
        results.failed.push({ order_id: orderId, error: `Cannot rollback from ${fromStatus} to ${toStatus}` })
        continue
      }

      const updates =
        toStatus === 'Pending'
          ? { status: 'Pending', posted_at: null, delivered_at: null, delivered_by: null, updated_at: new Date().toISOString() }
          : { status: 'Posted', delivered_at: null, delivered_by: null, updated_at: new Date().toISOString() }

      const { error: upErr } = await supabase.from('orders').update(updates).eq('order_id', orderId).eq('status', fromStatus)
      if (upErr) {
        results.failed.push({ order_id: orderId, error: upErr.message })
        continue
      }

      await supabase.from('audit_log').insert({
        module: 'food',
        actor: adminId,
        action: 'rollback',
        order_id: orderId,
        cycle_id: o.cycle_id,
        delivery_branch_id: o.delivery_branch_id,
        detail: { from: fromStatus, to: toStatus, note },
      })

      results.rolledBack.push(orderId)
    }

    return NextResponse.json({ ok: true, ...results })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
