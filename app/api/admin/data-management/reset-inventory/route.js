import { createClient } from '../../../../../lib/supabaseServer'
import { validateSession } from '../../../../../lib/validation'
import { csrfGuard } from '../../../../../lib/csrf'

export async function POST(request) {
  const csrfResponse = csrfGuard(request)
  if (csrfResponse) return csrfResponse
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

    const movementsHasCycle = await hasColumn('inventory_movements', 'cycle_id')
    const pricesHasCycle = await hasColumn('branch_item_prices', 'cycle_id')
    let activeCycleId = null
    if (movementsHasCycle || pricesHasCycle) {
      const requestedCycleId = body.cycle_id != null ? Number(body.cycle_id) : null
      if (requestedCycleId != null && !Number.isFinite(requestedCycleId)) {
        return Response.json({ ok: false, error: 'Invalid cycle_id' }, { status: 400 })
      }
      if (requestedCycleId) {
        activeCycleId = requestedCycleId
      } else {
        const { data: activeCycle, error: cycleErr } = await supabase
          .from('cycles')
          .select('id')
          .eq('is_active', true)
          .maybeSingle()
        if (cycleErr) {
          console.error('Error fetching active cycle:', cycleErr)
          return Response.json({ ok: false, error: 'Failed to fetch active cycle' }, { status: 500 })
        }
        if (!activeCycle?.id) {
          return Response.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
        }
        activeCycleId = activeCycle.id
      }
    }

    // First get all branch_item_prices to count them
    let countQuery = supabase.from('branch_item_prices').select('id')
    if (pricesHasCycle) countQuery = countQuery.eq('cycle_id', activeCycleId)
    const { data: branchItems, error: fetchError } = await countQuery

    if (fetchError) {
      console.error('Error fetching branch items:', fetchError)
      return Response.json({ ok: false, error: 'Failed to fetch inventory items' }, { status: 500 })
    }

    if (!branchItems || branchItems.length === 0) {
      return Response.json({ 
        ok: true, 
        updatedCount: 0,
        message: 'No inventory items found to reset'
      })
    }

    // Reset inventory by clearing all inventory movements (stock is derived from movements)
    let movementsQuery = supabase.from('inventory_movements').delete().neq('id', 0)
    if (movementsHasCycle) movementsQuery = movementsQuery.eq('cycle_id', activeCycleId)
    const { error: movementsError } = await movementsQuery

    if (movementsError) {
      console.error('Error clearing inventory movements:', movementsError)
      return Response.json({ ok: false, error: 'Failed to clear inventory movements' }, { status: 500 })
    }

    return Response.json({ 
      ok: true, 
      updatedCount: branchItems.length,
      message: activeCycleId ? `Inventory quantities reset for cycle_id=${activeCycleId}` : 'Inventory quantities reset to zero successfully'
    })
  } catch (error) {
    console.error('Error in reset-inventory:', error)
    return Response.json({ ok: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
