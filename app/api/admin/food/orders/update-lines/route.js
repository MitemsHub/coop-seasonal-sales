import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabaseServer'

export async function POST(req) {
  try {
    const supabase = createClient()
    const { orderId, lines } = await req.json()
    if (!orderId || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ ok: false, error: 'orderId and lines are required' }, { status: 400 })
    }

    const { error: ordersColErr } = await supabase.from('orders').select('cycle_id').limit(1)
    const { error: pricesColErr } = await supabase.from('branch_item_prices').select('cycle_id').limit(1)
    const { error: markupsColErr } = await supabase.from('branch_item_markups').select('cycle_id').limit(1)
    const { error: cyclesColErr } = await supabase.from('cycles').select('food_loan_interest_rate_pct').limit(1)
    const ordersHasCycle = !ordersColErr
    const pricesHasCycle = !pricesColErr
    const markupsHasCycle = !markupsColErr
    const cyclesHasInterestRate = !cyclesColErr

    let orderQuery = supabase
      .from('orders')
      .select(
        ordersHasCycle
          ? 'order_id, status, delivery_branch_id, payment_option, member_id, cycle_id'
          : 'order_id, status, delivery_branch_id, payment_option, member_id'
      )
      .eq('order_id', orderId)
    const { data: order, error: oErr } = await orderQuery.single()
    if (oErr || !order) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
    if (order.status !== 'Pending') {
      return NextResponse.json({ ok: false, error: 'Only Pending orders can be edited' }, { status: 400 })
    }

    let activeCycleId = null
    if (ordersHasCycle && order.cycle_id) {
      activeCycleId = order.cycle_id
    } else if (pricesHasCycle) {
      const { data: activeCycle, error: cycleErr } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
      if (cycleErr) return NextResponse.json({ ok: false, error: cycleErr.message }, { status: 500 })
      if (!activeCycle?.id) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
      activeCycleId = activeCycle.id
    }

    const validatedLines = lines.map((l) => {
      const qty = Number(l.qty || 0)
      if (!l.sku || qty <= 0) {
        throw new Error('Invalid line: SKU and positive quantity required')
      }
      return { sku: l.sku, qty }
    })

    const manualUpdate = async () => {
      const skus = validatedLines.map((l) => l.sku)
      // Retired twins can't take orders: only active items resolve here, so
      // a stale twin SKU surfaces as "Items not found" instead of silently
      // routing the admin's edit to the retired row.
      const { data: items, error: itemsErr } = await supabase.from('items').select('item_id, sku').in('sku', skus).eq('is_active', true)
      if (itemsErr) throw new Error(itemsErr.message)
      const skuToItem = new Map(items.map((i) => [i.sku, i.item_id]))

      const missing = validatedLines.filter((l) => !skuToItem.get(l.sku)).map((l) => l.sku)
      if (missing.length) throw new Error('Items not found: ' + missing.join(', '))

      const itemIds = validatedLines.map((l) => skuToItem.get(l.sku))
      let pricesQuery = supabase.from('branch_item_prices').select('id, item_id, price').eq('branch_id', order.delivery_branch_id).in('item_id', itemIds)
      if (pricesHasCycle) pricesQuery = pricesQuery.eq('cycle_id', activeCycleId)

      const { data: prices, error: pricesErr } = await pricesQuery
      if (pricesErr) throw new Error(pricesErr.message)
      const itemToPrice = new Map(prices.map((p) => [p.item_id, { id: p.id, price: Number(p.price) }]))

      // Branch markup rides on top of the base price — order creation and the
      // repricer both price lines this way, so an edit has to as well.
      let markupQuery = supabase
        .from('branch_item_markups')
        .select('item_id, amount')
        .eq('branch_id', order.delivery_branch_id)
        .eq('active', true)
        .in('item_id', itemIds)
      if (markupsHasCycle && activeCycleId) markupQuery = markupQuery.eq('cycle_id', activeCycleId)
      const { data: markups, error: markupsErr } = await markupQuery
      if (markupsErr) throw new Error(markupsErr.message)
      const itemToMarkup = new Map((markups || []).map((m) => [m.item_id, Number(m.amount || 0)]))

      let subtotal = 0
      const linesPayload = validatedLines.map((l) => {
        const itemId = skuToItem.get(l.sku)
        const pr = itemToPrice.get(itemId)
        if (!pr) throw new Error('No price found for item: ' + l.sku)
        const qty = Number(l.qty)
        const unit_price = pr.price + (itemToMarkup.get(itemId) || 0)
        const amount = unit_price * qty
        subtotal += amount
        return { order_id: orderId, item_id: itemId, branch_item_price_id: pr.id, unit_price, qty, amount }
      })

      const { error: delErr } = await supabase.from('order_lines').delete().eq('order_id', orderId)
      if (delErr) throw new Error(delErr.message)

      const { error: insErr } = await supabase.from('order_lines').insert(linesPayload)
      if (insErr) throw new Error(insErr.message)

      // Loan orders store the repayable amount, so the interest has to come
      // back with the new subtotal or the View-items modal shows ₦0 interest
      // and the order is under-stated from here on.
      let ratePct = 13
      if (cyclesHasInterestRate && activeCycleId) {
        const { data: rateRow, error: rateErr } = await supabase
          .from('cycles')
          .select('food_loan_interest_rate_pct')
          .eq('id', activeCycleId)
          .maybeSingle()
        if (!rateErr && rateRow && rateRow.food_loan_interest_rate_pct != null) {
          ratePct = Math.max(0, Number(rateRow.food_loan_interest_rate_pct || 0))
        }
      }
      const interest = order.payment_option === 'Loan' ? Math.round(subtotal * (ratePct / 100)) : 0
      const total = subtotal + interest

      const { error: updErr } = await supabase.from('orders').update({ total_amount: total }).eq('order_id', orderId)
      if (updErr) throw new Error(updErr.message)

      return { ok: true, total, subtotal, interest, lines_updated: linesPayload.length }
    }

    // Priced here instead of through the update_order_lines_batch RPC: that
    // function writes base prices only — it re-applies neither the branch
    // markup nor the Loan interest, so every edit silently dropped both.
    try {
      const result = await manualUpdate()
      return NextResponse.json(result)
    } catch (fallbackErr) {
      const msg = fallbackErr.message || 'Update failed'
      return NextResponse.json({ ok: false, error: msg }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
