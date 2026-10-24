// app/api/rep/orders/update/route.js
import { NextResponse } from 'next/server'
// Service-role client: the session above was already validated with the
// rep token; under full RLS the anon-key cookie client would fail.
import { createClient } from '../../../../../lib/supabaseServer'
import { validateSession } from '../../../../../lib/validation'

export async function PUT(request) {
  try {
    const { orderId, orderLines } = await request.json()
    
    if (!orderId || !orderLines || !Array.isArray(orderLines)) {
      return NextResponse.json({ ok: false, error: 'Invalid request data' }, { status: 400 })
    }

    if (orderLines.length === 0) {
      return NextResponse.json({ ok: false, error: 'Order must have at least one item' }, { status: 400 })
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

    const supabase = createClient()

    const { error: ordersColErr } = await supabase.from('orders').select('cycle_id').limit(1)
    const { error: pricesColErr } = await supabase.from('branch_item_prices').select('cycle_id').limit(1)
    const ordersHasCycle = !ordersColErr
    const pricesHasCycle = !pricesColErr

    // Check if order exists and belongs to the rep's branch
    let orderQuery = supabase
      .from('orders')
      .select(ordersHasCycle ? 'order_id, status, delivery_branch_id, cycle_id' : 'order_id, status, delivery_branch_id')
      .eq('order_id', orderId)
      .eq('delivery_branch_id', branch_id)
    const { data: order, error: orderError } = await orderQuery.single()

    if (orderError || !order) {
      return NextResponse.json({ ok: false, error: 'Order not found or access denied' }, { status: 404 })
    }

    if (order.status !== 'Pending') {
      return NextResponse.json({ ok: false, error: 'Only pending orders can be edited' }, { status: 400 })
    }

    let activeCycleId = null
    if (pricesHasCycle) {
      if (ordersHasCycle && order.cycle_id) {
        activeCycleId = order.cycle_id
      } else {
        const { data: activeCycle, error: cycleErr } = await supabase
          .from('cycles')
          .select('id')
          .eq('is_active', true)
          .maybeSingle()
        if (cycleErr) {
          console.error('Active cycle fetch error:', cycleErr)
          return NextResponse.json({ ok: false, error: 'Failed to load active cycle' }, { status: 500 })
        }
        if (!activeCycle?.id) {
          return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
        }
        activeCycleId = activeCycle.id
      }
    }

    // Validate order lines against branch_item_prices
    let calculatedTotal = 0
    const validatedOrderLines = []
    
    for (const line of orderLines) {
      if (!line.item_id || !line.qty || line.qty <= 0) {
        return NextResponse.json({ ok: false, error: 'Invalid order line data' }, { status: 400 })
      }

      // Validate that item exists
      const { data: item, error: itemError } = await supabase
        .from('items')
        .select('item_id, sku')
        .eq('item_id', line.item_id)
        .single()

      if (itemError || !item) {
        return NextResponse.json({ ok: false, error: `Item not found: ${line.item_id}` }, { status: 400 })
      }

      // Validate that price exists for this item in this branch
      let priceQuery = supabase
        .from('branch_item_prices')
        .select('id, price')
        .eq('branch_id', branch_id)
        .eq('item_id', line.item_id)
      if (pricesHasCycle) priceQuery = priceQuery.eq('cycle_id', activeCycleId)

      const { data: priceRow, error: priceError } = await priceQuery.single()

      if (priceError || !priceRow) {
        return NextResponse.json({ ok: false, error: `No price for ${item.sku} in this branch` }, { status: 400 })
      }

      // Use the validated price from database, not the client-provided price
      const validatedPrice = Number(priceRow.price)
      const amount = validatedPrice * line.qty
      calculatedTotal += amount

      validatedOrderLines.push({
        order_id: orderId,
        item_id: line.item_id,
        branch_item_price_id: priceRow.id,
        qty: line.qty,
        unit_price: validatedPrice,
        amount: amount
      })
    }

    // Start transaction by deleting existing order lines
    const { error: deleteError } = await supabase
      .from('order_lines')
      .delete()
      .eq('order_id', orderId)

    if (deleteError) {
      console.error('Delete order lines error:', deleteError)
      return NextResponse.json({ ok: false, error: 'Failed to update order lines' }, { status: 500 })
    }

    // Insert new order lines with validated data
    const { error: insertError } = await supabase
      .from('order_lines')
      .insert(validatedOrderLines)

    if (insertError) {
      console.error('Insert order lines error:', insertError)
      return NextResponse.json({ ok: false, error: 'Failed to insert order lines' }, { status: 500 })
    }

    // Update order total amount with server-calculated total
    const { error: updateOrderError } = await supabase
      .from('orders')
      .update({ 
        total_amount: calculatedTotal
      })
      .eq('order_id', orderId)

    if (updateOrderError) {
      console.error('Update order error:', updateOrderError)
      return NextResponse.json({ ok: false, error: 'Failed to update order' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: 'Order updated successfully' })
  } catch (error) {
    console.error('Update order API error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
