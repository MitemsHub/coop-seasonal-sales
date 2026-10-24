// app/api/items/list/route.js
import { NextResponse } from 'next/server'
// Service-role client: public shop-catalog loader; output is server-shaped,
// and under full RLS the anon-key cookie client would break.
import { createClient } from '../../../../lib/supabaseServer'

export async function GET() {
  try {
    const supabase = createClient()

    const { error: colErr } = await supabase.from('branch_item_prices').select('cycle_id').limit(1)
    const pricesHasCycle = !colErr
    let activeCycleId = null
    if (pricesHasCycle) {
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('cycles')
        .select('id')
        .eq('is_active', true)
        .maybeSingle()
      if (cycleErr) {
        console.error('Error fetching active cycle:', cycleErr)
        return NextResponse.json({ ok: false, error: 'Failed to load active cycle' }, { status: 500 })
      }
      if (!activeCycle?.id) {
        return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
      }
      activeCycleId = activeCycle.id
    }
    
    // Get all items with prices from branch_item_prices (distinct items only)
    let query = supabase
      .from('branch_item_prices')
      .select(`
        price,
        items:item_id(
          item_id,
          name,
          sku,
          unit,
          category
        )
      `)
      .order('name', { foreignTable: 'items' })

    if (pricesHasCycle) query = query.eq('cycle_id', activeCycleId)

    const { data: itemsWithPrices, error } = await query
    
    if (error) {
      console.error('Error fetching items:', error)
      return NextResponse.json({ ok: false, error: 'Failed to fetch items' }, { status: 500 })
    }
    
    // Transform data to expected format and ensure unique items
    const itemsMap = new Map()
    ;(itemsWithPrices || []).forEach(row => {
      const itemId = row.items.item_id
      if (!itemsMap.has(itemId)) {
        itemsMap.set(itemId, {
          id: itemId,
          name: row.items.name,
          sku: row.items.sku,
          unit: row.items.unit,
          category: row.items.category,
          price: Number(row.price || 0)
        })
      }
    })
    const items = Array.from(itemsMap.values())
    
    return NextResponse.json({ ok: true, items })
  } catch (error) {
    console.error('Items list error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
