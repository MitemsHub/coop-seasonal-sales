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

    const { orderId, note } = await req.json()
    // ensure the order belongs to this delivery branch
    const { data: o } = await supabase.from('orders').select('order_id, delivery_branch_id').eq('order_id', orderId).single()
    if (!o || o.delivery_branch_id !== claim.branch_id) return NextResponse.json({ ok:false, error:'forbidden' }, { status:403 })

    const { data, error } = await supabase.rpc('post_order', { p_order_id: orderId, p_admin: `rep:${claim.branch_code}` })
    console.log('RPC post_order result:', { orderId, data, error })
    
    // Check if RPC function returned an error in the data
    if (error) {
      console.error('RPC post_order error:', error)
      return NextResponse.json({ ok:false, error: error.message }, { status:400 })
    }
    
    if (data && !data.success) {
      console.error('RPC post_order failed:', data)
      return NextResponse.json({ ok:false, error: data.error || 'Post failed' }, { status:400 })
    }

    await supabase.from('orders').update({ admin_note: note || null }).eq('order_id', orderId)
    await supabase.from('audit_log').insert({ module:'food', actor:`rep:${claim.branch_code}`, action:'post', order_id: orderId, detail: { note } })

    return NextResponse.json({ ok:true })
  } catch (e) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 })
  }
}
