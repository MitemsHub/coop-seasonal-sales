import { createClient } from '../../../../../lib/supabaseServer'
import { validateSession } from '../../../../../lib/validation'

export async function POST(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient()
    const body = await request.json().catch(() => ({}))

    const hasColumn = async (table, column) => {
      const { error } = await supabase.from(table).select(column).limit(1)
      return !error
    }

    const ordersHasCycle = await hasColumn('orders', 'cycle_id')
    const movementsHasCycle = await hasColumn('inventory_movements', 'cycle_id')
    const movementsHasReferenceId = await hasColumn('inventory_movements', 'reference_id')

    let cycleId = body.cycle_id != null ? Number(body.cycle_id) : null
    if (cycleId != null && !Number.isFinite(cycleId)) {
      return Response.json({ ok: false, error: 'Invalid cycle_id' }, { status: 400 })
    }
    // Require cycle_id — never allow deleting ALL delivered orders without specifying a cycle
    if (!cycleId && ordersHasCycle) {
      const { data: active, error: activeErr } = await supabase
        .from('cycles')
        .select('id')
        .eq('is_active', true)
        .maybeSingle()
      if (activeErr) return Response.json({ ok: false, error: activeErr.message }, { status: 500 })
      if (!active?.id) return Response.json({ ok: false, error: 'No active cycle found. Pass cycle_id to clear a specific cycle.' }, { status: 400 })
      cycleId = active.id
    }
    if (!cycleId) {
      return Response.json({ ok: false, error: 'cycle_id is required to prevent accidental data loss' }, { status: 400 })
    }

    // First, get all delivered order IDs
    let deliveredQuery = supabase
      .from('orders')
      .select('order_id')
      .eq('status', 'Delivered')
    if (ordersHasCycle && cycleId) deliveredQuery = deliveredQuery.eq('cycle_id', cycleId)
    const { data: deliveredOrders, error: fetchError } = await deliveredQuery

    if (fetchError) {
      console.error('Error fetching delivered orders:', fetchError)
      return Response.json({ ok: false, error: 'Failed to fetch delivered orders' }, { status: 500 })
    }

    if (!deliveredOrders || deliveredOrders.length === 0) {
      return Response.json({ 
        ok: true, 
        deletedCount: 0,
        message: 'No delivered orders found to clear'
      })
    }

    const orderIds = deliveredOrders.map(order => order.order_id)

    if (movementsHasCycle && cycleId && movementsHasReferenceId) {
      const { error: movementsError } = await supabase
        .from('inventory_movements')
        .delete()
        .eq('cycle_id', cycleId)
        .in('reference_id', orderIds)
        .eq('reference_type', 'order')

      if (movementsError) {
        console.error('Error deleting inventory movements:', movementsError)
        return Response.json({ ok: false, error: 'Failed to delete inventory movements' }, { status: 500 })
      }
    }

    // Then, delete order lines for delivered orders
    const { error: linesError } = await supabase
      .from('order_lines')
      .delete()
      .in('order_id', orderIds)

    if (linesError) {
      console.error('Error deleting order lines:', linesError)
      return Response.json({ ok: false, error: 'Failed to delete order lines' }, { status: 500 })
    }

    // Delete delivered orders
    let ordersDeleteQuery = supabase
      .from('orders')
      .delete()
      .eq('status', 'Delivered')
    if (ordersHasCycle && cycleId) ordersDeleteQuery = ordersDeleteQuery.eq('cycle_id', cycleId)
    const { error: ordersError } = await ordersDeleteQuery

    if (ordersError) {
      console.error('Error deleting delivered orders:', ordersError)
      return Response.json({ ok: false, error: 'Failed to delete delivered orders' }, { status: 500 })
    }

    return Response.json({ 
      ok: true, 
      deletedCount: deliveredOrders.length,
      message: cycleId ? `Delivered orders cleared for cycle_id=${cycleId}` : 'Delivered orders cleared successfully'
    })
  } catch (error) {
    console.error('Error in clear-delivered:', error)
    return Response.json({ ok: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
