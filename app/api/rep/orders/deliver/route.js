import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verify } from '@/lib/signing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const token = req.cookies.get('rep_token')?.value
    const claim = token && verify(token)
    if (!claim || claim.role !== 'rep') return NextResponse.json({ ok:false, error:'unauthorized' }, { status:401 })
    if (claim.module && claim.module !== 'food') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    if (!Number.isFinite(Number(claim.branch_id)) || Number(claim.branch_id) <= 0) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    const { orderId, deliveredBy } = await req.json()
    const { data: o } = await supabase.from('orders').select('order_id, delivery_branch_id').eq('order_id', orderId).single()
    if (!o || o.delivery_branch_id !== claim.branch_id) return NextResponse.json({ ok:false, error:'forbidden' }, { status:403 })

    const { error } = await supabase.rpc('deliver_order', { p_order_id: orderId, p_admin: `rep:${claim.branch_code}` })
    if (error) return NextResponse.json({ ok:false, error: error.message }, { status:400 })

    await supabase.from('orders').update({ delivered_by: deliveredBy || `rep:${claim.branch_code}`, delivered_at: new Date().toISOString() }).eq('order_id', orderId)
    await supabase.from('audit_log').insert({ module:'food', actor:`rep:${claim.branch_code}`, action:'deliver', order_id: orderId, detail: { deliveredBy } })

    return NextResponse.json({ ok:true })
  } catch (e) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 })
  }
}
