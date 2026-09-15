// app/api/admin/markups/bulk-location-update/route.js
// Bulk remove specific items (by SKU) from all food orders at a given delivery
// branch.  Used when a product becomes unavailable after orders were placed —
// instead of cancelling entire orders, the admin removes only the affected items.
//
// POST { branch_code, skus: string[], cycle_id?: number }
//
// Returns { ok, affected_orders, removed_lines, errors }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const branchCode = String(body.branch_code || '').trim()
    const skus = Array.isArray(body.skus) ? body.skus.map((s) => String(s || '').trim()).filter(Boolean) : []
    const cycleId = body.cycle_id != null ? Number(body.cycle_id) : null

    if (!branchCode) {
      return NextResponse.json({ ok: false, error: 'branch_code is required' }, { status: 400 })
    }
    if (!skus.length) {
      return NextResponse.json({ ok: false, error: 'At least one SKU is required' }, { status: 400 })
    }

    const supabase = createClient()

    // 1. Resolve branch id from code
    const { data: branch, error: bErr } = await supabase
      .from('branches')
      .select('id')
      .eq('code', branchCode)
      .maybeSingle()
    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    if (!branch) return NextResponse.json({ ok: false, error: `Branch "${branchCode}" not found` }, { status: 404 })
    const branchId = branch.id

    // 2. Resolve item_ids from SKUs
    const { data: items, error: iErr } = await supabase
      .from('items')
      .select('item_id, sku')
      .in('sku', skus)
    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 500 })
    const foundSkus = (items || []).map((i) => i.sku)
    const missingSkus = skus.filter((s) => !foundSkus.includes(s))
    const itemIds = (items || []).map((i) => i.item_id)

    if (!itemIds.length) {
      return NextResponse.json({ ok: false, error: `No items found for SKUs: ${skus.join(', ')}` }, { status: 404 })
    }

    // 3. Find all orders at this delivery branch (Pending/Posted status only — don't touch Delivered/Cancelled)
    let ordersQuery = supabase
      .from('orders')
      .select('order_id, status, total_amount, payment_option')
      .eq('delivery_branch_id', branchId)
      .in('status', ['Pending', 'Posted'])

    if (cycleId != null) {
      ordersQuery = ordersQuery.eq('cycle_id', cycleId)
    }

    const { data: orders, error: oErr } = await ordersQuery
    if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 })

    if (!orders || orders.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No Pending/Posted orders found for this branch',
        affected_orders: 0,
        removed_lines: 0,
        missing_skus: missingSkus,
      })
    }

    const orderIds = orders.map((o) => o.order_id)

    // 4. Find order_lines that match the SKUs in those orders
    const { data: linesToRemove, error: lErr } = await supabase
      .from('order_lines')
      .select('id, order_id, item_id, quantity, unit_price, line_total')
      .in('order_id', orderIds)
      .in('item_id', itemIds)

    if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })

    if (!linesToRemove || linesToRemove.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No matching order lines found for the selected items',
        affected_orders: 0,
        removed_lines: 0,
        missing_skus: missingSkus,
      })
    }

    // 5. Delete the matching order_lines
    const lineIds = linesToRemove.map((l) => l.id)
    const { error: delErr } = await supabase
      .from('order_lines')
      .delete()
      .in('id', lineIds)

    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    // 6. Recalculate totals for affected orders
    const affectedOrderIds = [...new Set(linesToRemove.map((l) => l.order_id))]
    const errors = []

    for (const orderId of affectedOrderIds) {
      // Get remaining lines for this order
      const { data: remainingLines } = await supabase
        .from('order_lines')
        .select('line_total')
        .eq('order_id', orderId)

      const newTotal = (remainingLines || []).reduce((sum, l) => sum + Number(l.line_total || 0), 0)

      if (!remainingLines || remainingLines.length === 0) {
        // Order has no more items — cancel it
        const { error: cancelErr } = await supabase
          .from('orders')
          .update({ status: 'Cancelled', total_amount: 0, updated_at: new Date().toISOString() })
          .eq('order_id', orderId)
        if (cancelErr) errors.push({ order_id: orderId, error: cancelErr.message })
      } else {
        // Update the order total
        const { error: updateErr } = await supabase
          .from('orders')
          .update({ total_amount: Math.round(newTotal * 100) / 100, updated_at: new Date().toISOString() })
          .eq('order_id', orderId)
        if (updateErr) errors.push({ order_id: orderId, error: updateErr.message })
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Removed ${linesToRemove.length} item(s) from ${affectedOrderIds.length} order(s)`,
      affected_orders: affectedOrderIds.length,
      removed_lines: linesToRemove.length,
      removed_details: linesToRemove.map((l) => ({
        order_id: l.order_id,
        item_id: l.item_id,
        quantity: l.quantity,
        line_total: l.line_total,
      })),
      missing_skus: missingSkus,
      errors,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to bulk update' }, { status: 500 })
  }
}
