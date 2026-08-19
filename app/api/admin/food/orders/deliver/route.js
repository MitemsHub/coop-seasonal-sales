import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { orderId, adminId, deliveredBy } = await req.json()
    if (!orderId) return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })

    const { data: o } = await supabase.from('orders').select('order_id, cycle_id, delivery_branch_id').eq('order_id', orderId).single()
    if (!o) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    const { data: result, error } = await supabase.rpc('deliver_order', { p_order_id: orderId, p_admin: adminId || 'admin' })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    if (result && !result.success) return NextResponse.json({ ok: false, error: result.error }, { status: 400 })

    await supabase
      .from('orders')
      .update({ delivered_by: deliveredBy || adminId || 'admin', delivered_at: new Date().toISOString() })
      .eq('order_id', orderId)

    await supabase.from('audit_log').insert({
      module: 'food',
      actor: adminId || 'admin',
      action: 'deliver',
      order_id: orderId,
      cycle_id: o.cycle_id,
      delivery_branch_id: o.delivery_branch_id,
      detail: { deliveredBy: deliveredBy || adminId || 'admin' },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
