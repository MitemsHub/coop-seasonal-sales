import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { orderId, adminId, adminNote } = await req.json()
    if (!orderId) return NextResponse.json({ ok: false, error: 'orderId required' }, { status: 400 })

    const { data: o, error: oErr } = await supabase
      .from('orders')
      .select('order_id, cycle_id, delivery_branch_id')
      .eq('order_id', orderId)
      .single()
    if (oErr || !o) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    const { data: result, error } = await supabase.rpc('post_order', { p_order_id: orderId, p_admin: adminId || 'admin' })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    if (result && !result.success) return NextResponse.json({ ok: false, error: result.error }, { status: 400 })

    if (adminNote) {
      await supabase.from('orders').update({ admin_note: adminNote }).eq('order_id', orderId)
    }

    await supabase.from('audit_log').insert({
      module: 'food',
      actor: adminId || 'admin',
      action: 'post',
      order_id: orderId,
      cycle_id: o.cycle_id,
      delivery_branch_id: o.delivery_branch_id,
      detail: { adminNote },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
