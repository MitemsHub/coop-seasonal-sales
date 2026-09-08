// app/api/rep/orders/cancel/route.js
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../../../../lib/supabaseServer'
import { validateSession } from '../../../../../lib/validation'
import { csrfGuard } from '../../../../../lib/csrf'

export async function POST(request) {
  const csrfResponse = csrfGuard(request)
  if (csrfResponse) return csrfResponse
  try {
    const { orderId, reason } = await request.json()
    
    if (!orderId) {
      return NextResponse.json({ ok: false, error: 'Order ID is required' }, { status: 400 })
    }

    // Validate session and get user info
    const sessionResult = await validateSession(request, 'rep')
    if (!sessionResult.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { branch_id } = sessionResult.claims
    if (sessionResult.claims?.module && sessionResult.claims.module !== 'food') {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }
    if (!Number.isFinite(Number(branch_id)) || Number(branch_id) <= 0) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const supabase = await createSupabaseServerClient()

    // Check if order exists and belongs to the rep's branch
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('order_id, status, delivery_branch_id')
      .eq('order_id', orderId)
      .eq('delivery_branch_id', branch_id)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ ok: false, error: 'Order not found or access denied' }, { status: 404 })
    }

    if (order.status !== 'Pending') {
      return NextResponse.json({ ok: false, error: 'Only pending orders can be cancelled' }, { status: 400 })
    }

    // Update order status to cancelled
    const { error: updateError } = await supabase
      .from('orders')
      .update({ 
        status: 'Cancelled'
      })
      .eq('order_id', orderId)

    if (updateError) {
      console.error('Cancel order error:', updateError)
      return NextResponse.json({ ok: false, error: 'Failed to cancel order' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: 'Order cancelled successfully' })
  } catch (error) {
    console.error('Cancel order API error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
