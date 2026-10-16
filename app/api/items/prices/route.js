// app/api/items/prices/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'
import { getCached } from '../../../../lib/cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const branchCode = searchParams.get('branch')
    
    if (!branchCode) {
      return NextResponse.json({ ok: false, error: 'Branch parameter is required' }, { status: 400 })
    }
    
    const hasColumn = async (table, column) => {
      const { error } = await supabase.from(table).select(column).limit(1)
      return !error
    }

    const [markupsHasCycle, viewHasCycle] = await Promise.all([
      hasColumn('branch_item_markups', 'cycle_id'),
      hasColumn('v_inventory_status', 'cycle_id')
    ])

    let activeCycleId = null
    if (markupsHasCycle || viewHasCycle) {
      let { data: active, error: activeErr } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
      if (activeErr) {
        const msg = String(activeErr?.message || '')
        if (!/is_active/i.test(msg)) throw activeErr
        active = null
      }
      if (active?.id) activeCycleId = active.id
      if (!activeCycleId) {
        const { data: latest, error: latestErr } = await supabase.from('cycles').select('id').order('id', { ascending: false }).limit(1).maybeSingle()
        if (latestErr) throw latestErr
        activeCycleId = latest?.id ?? null
      }
    }

    const cacheKey = activeCycleId ? `items-prices:${branchCode}:${activeCycleId}` : `items-prices:${branchCode}`

    const items = await getCached(cacheKey, async () => {
      // Resolve branch id for markup lookup
      const { data: branch, error: brErr } = await supabase
        .from('branches')
        .select('id, code')
        .eq('code', branchCode)
        .single()
      if (brErr || !branch) {
        throw new Error('Branch not found')
      }

      // Fetch items with prices and demand data from optimized inventory view
      let itemsQuery = supabase
        .from('v_inventory_status')
        .select(`
          price,
          total_demand,
          pending_demand,
          confirmed_demand,
          delivered_demand,
          item_id,
          item_name,
          sku,
          unit,
          category
        `)
        .eq('branch_code', branchCode)
        .gt('price', 0)
        .order('item_name')
      if (viewHasCycle && activeCycleId) itemsQuery = itemsQuery.eq('cycle_id', activeCycleId)

      const { data: itemsWithPrices, error } = await itemsQuery
      
      if (error) {
        console.error('Error fetching items with prices:', error)
        throw new Error('Failed to fetch items')
      }

      // Load markups for this branch and map by item_id
      let markupsQuery = supabase
        .from('branch_item_markups')
        .select('item_id, amount, active')
        .eq('branch_id', branch.id)
      if (markupsHasCycle && activeCycleId) markupsQuery = markupsQuery.eq('cycle_id', activeCycleId)
      const { data: markups, error: muErr } = await markupsQuery
      if (muErr) {
        console.warn('Markups fetch error:', muErr.message)
      }
      const markupByItemId = new Map((markups || []).filter(m => m.active).map(m => [m.item_id, Number(m.amount || 0)]))
      
      // Branch-cancelled survey entries hide their linked products from this
      // branch's shop — the same rule the admin's shop preview applies, so
      // a "Cancel for <branch>" actually takes the product off this
      // branch's shelf. Cycle-scoped: only submissions tagged with the
      // active cycle (or untagged legacy ones) count, like the preview uses.
      let cancelledItemIds = new Set()
      {
        const subsFilter =
          activeCycleId != null
            ? 'cycle_id.eq.' + Number(activeCycleId) + ',cycle_id.is.null'
            : 'cycle_id.is.null'
        const { data: subs } = await supabase
          .from('food_survey_submissions')
          .select('id')
          .eq('branch_id', branch.id)
          .or(subsFilter)
        const subIds = (subs || []).map((s) => s.id)
        if (subIds.length) {
          const { data: ents } = await supabase
            .from('food_survey_entries')
            .select('cancelled, saved_item_id')
            .in('submission_id', subIds)
          const rawLinks = new Set()
          for (const e of ents || []) {
            if (e.cancelled === true && e.saved_item_id != null) {
              rawLinks.add(Number(e.saved_item_id))
            }
          }
          // Cancelled hides only OUTSOURCED products. A rep's mistaken
          // duplicate of a GENERAL item keeps selling from the General item —
          // cancelling the outsourced copy never pulls the General twin.
          if (rawLinks.size) {
            const { data: linkItems } = await supabase
              .from('items')
              .select('item_id, source')
              .in('item_id', [...rawLinks])
            if (linkItems && linkItems.length) {
              for (const li of linkItems) {
                if ((li.source || 'general') === 'outsourced') cancelledItemIds.add(li.item_id)
              }
            } else {
              // source column unknown → keep the old behavior (hide the link)
              for (const id of rawLinks) cancelledItemIds.add(id)
            }
          }
        }
      }

      // Transform data to expected format for demand tracking
      return (itemsWithPrices || [])
        .filter((row) => !cancelledItemIds.has(row.item_id))
        .map(row => {
        const base = Number(row.price || 0)
        const mk = markupByItemId.get(row.item_id) || 0
        return {
          id: row.item_id,
          name: row.item_name,
          sku: row.sku,
          unit: row.unit,
          category: row.category,
          price: base + mk,
          demand: {
            total: Number(row.total_demand || 0),
            pending: Number(row.pending_demand || 0),
            confirmed: Number(row.confirmed_demand || 0),
            delivered: Number((row.delivered_demand ?? row.delivered_qty ?? 0))
          }
        }
      })
    }, 60) // cache for 60 seconds
    
    return NextResponse.json({ ok: true, items })
  } catch (error) {
    console.error('Items prices error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
