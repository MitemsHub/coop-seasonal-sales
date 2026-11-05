// app/api/admin/reports/delivery-dept-items/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { validateSession } from '../../../../../lib/validation'
import { queryDirect } from '../../../../../lib/directDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Helper: Supabase-based aggregation using core tables (orders + order_lines)
async function aggregateViaTables(supabase, { branchCode, departmentId, ordersHasCycle, pricesHasCycle, markupsHasCycle, activeCycleId }) {
  const statuses = ['Pending', 'Posted', 'Delivered']

  // Resolve delivery branch filter to ids (if provided)
  let deliveryBranchIds = []
  if (branchCode) {
    const { data: branches, error: bErr } = await supabase
      .from('branches')
      .select('id, code')
      .eq('code', branchCode)
    if (bErr) throw new Error(bErr.message)
    deliveryBranchIds = (branches || []).map(b => b.id)
    if (!deliveryBranchIds.length) return []
  }

  // Load orders for statuses and optional filters
  let ordersQ = supabase
    .from('orders')
    .select('order_id, delivery_branch_id, department_id, status')
    .in('status', statuses)
  if (deliveryBranchIds.length) ordersQ = ordersQ.in('delivery_branch_id', deliveryBranchIds)
  if (departmentId) ordersQ = ordersQ.eq('department_id', Number(departmentId))
  if (ordersHasCycle) ordersQ = ordersQ.eq('cycle_id', activeCycleId)
  const { data: orders, error: oErr } = await ordersQ
  if (oErr) throw new Error(oErr.message)
  if (!orders?.length) return []

  const orderIds = orders.map(o => o.order_id)
  const branchIdsInOrders = [...new Set(orders.map(o => o.delivery_branch_id).filter(Boolean))]
  const deptIdsInOrders = [...new Set(orders.map(o => o.department_id).filter(Boolean))]

  // Load order lines
  const { data: lines, error: lErr } = await supabase
    .from('order_lines')
    .select('order_id, item_id, qty, amount')
    .in('order_id', orderIds)
  if (lErr) throw new Error(lErr.message)
  if (!lines?.length) return []

  // Load items metadata for names
  const itemIdsSet = [...new Set(lines.map(l => l.item_id).filter(Boolean))]
  const { data: items, error: iErr } = await supabase
    .from('items')
    .select('item_id, name, category')
    .in('item_id', itemIdsSet)
  if (iErr) throw new Error(iErr.message)
  const itemNameById = new Map((items || []).map(i => [i.item_id, i.name]))
  const itemCategoryById = new Map((items || []).map(i => [i.item_id, i.category]))

  // Load base prices and active markups for branch+item pairs
  let priceMap = new Map()
  let markupMap = new Map()
  if (branchIdsInOrders.length && itemIdsSet.length) {
    let bipQ = supabase
      .from('branch_item_prices')
      .select('branch_id, item_id, price')
      .in('branch_id', branchIdsInOrders)
      .in('item_id', itemIdsSet)
    if (pricesHasCycle) bipQ = bipQ.eq('cycle_id', activeCycleId)

    let bimQ = supabase
      .from('branch_item_markups')
      .select('branch_id, item_id, amount, active')
      .in('branch_id', branchIdsInOrders)
      .in('item_id', itemIdsSet)
    if (markupsHasCycle) bimQ = bimQ.eq('cycle_id', activeCycleId)

    const [{ data: bipData, error: bipErr }, { data: bimData, error: bimErr }] = await Promise.all([bipQ, bimQ])
    if (bipErr) throw new Error(bipErr.message)
    if (bimErr) throw new Error(bimErr.message)
    priceMap = new Map((bipData || []).map(p => [`${p.branch_id}:${p.item_id}`, Number(p.price || 0)]))
    markupMap = new Map((bimData || []).filter(m => !!m.active).map(m => [`${m.branch_id}:${m.item_id}`, Number(m.amount || 0)]))
  }

  // Aggregate quantity per delivery branch + department + item
  const orderById = new Map(orders.map(o => [o.order_id, o]))
  const keyAgg = new Map()
  for (const l of lines) {
    const o = orderById.get(l.order_id)
    if (!o) continue
    const dept = o.department_id
    const branchId = o.delivery_branch_id
    const itemId = l.item_id
    const key = `${branchId || 'all'}|${dept || 'all'}|${itemId}`
    const prev = keyAgg.get(key)
    keyAgg.set(key, {
      branch_id: branchId,
      department_id: dept,
      item_id: itemId,
      quantity: Number((prev?.quantity || 0) + Number(l.qty || 0)),
      amount_sum: Number((prev?.amount_sum || 0) + Number(l.amount || 0))
    })
  }

  // Map branch_id to branch_code/name for display
  let branchesMeta = []
  if (branchIdsInOrders.length) {
    const { data: bMeta, error: bMetaErr } = await supabase
      .from('branches')
      .select('id, code, name')
      .in('id', branchIdsInOrders)
    if (bMetaErr) throw new Error(bMetaErr.message)
    branchesMeta = bMeta || []
  }
  const branchCodeById = new Map(branchesMeta.map(b => [b.id, b.code]))
  const branchNameById = new Map(branchesMeta.map(b => [b.id, b.name]))

  // Map department_id to name
  let departmentsMeta = []
  if (deptIdsInOrders.length) {
    const { data: dMeta, error: dErr } = await supabase
      .from('departments')
      .select('id, name')
      .in('id', deptIdsInOrders)
    if (dErr) throw new Error(dErr.message)
    departmentsMeta = dMeta || []
  }
  const deptNameById = new Map(departmentsMeta.map(d => [d.id, d.name]))

  // Compute price/amount; if multiple branches selected, pick max price+markup per item
  const rows = []
  const itemBranchPairs = new Map() // item_id -> Set(branch_id)
  for (const v of keyAgg.values()) {
    if (!itemBranchPairs.has(v.item_id)) itemBranchPairs.set(v.item_id, new Set())
    if (v.branch_id) itemBranchPairs.get(v.item_id).add(v.branch_id)
  }

  function priceForItemAcrossBranches(itemId) {
    const branchesSet = itemBranchPairs.get(itemId) || new Set()
    let maxOriginal = 0
    let maxMarkup = 0
    for (const bId of branchesSet) {
      const original = priceMap.get(`${bId}:${itemId}`) || 0
      const m = markupMap.get(`${bId}:${itemId}`) || 0
      if (original > maxOriginal) maxOriginal = original
      if (m > maxMarkup) maxMarkup = m
    }
    return { original: maxOriginal, markup: maxMarkup, price: maxOriginal + maxMarkup }
  }

  for (const v of keyAgg.values()) {
    const { original, markup } = priceForItemAcrossBranches(v.item_id)
    const itemName = itemNameById.get(v.item_id) || String(v.item_id)
    rows.push({
      items: itemName,
      // Price shown is base + configured markup; UI recomputes amount
      price: Number(original || 0) + Number(markup || 0),
      quantity: Number(v.quantity || 0),
      amount: Number(v.amount_sum || 0),
      branch_code: branchCodeById.get(v.branch_id) || null,
      branch_name: branchNameById.get(v.branch_id) || null,
      department_id: v.department_id || null,
      department_name: deptNameById.get(v.department_id) || null,
      original_price: Number(original || 0),
      markup: Number(markup || 0),
      category: itemCategoryById.get(v.item_id) || null
    })
  }

  // Merge by item name for cleaner presentation when multiple branches are selected
  const byItem = new Map()
  for (const r of rows) {
    const key = r.items
    const prev = byItem.get(key)
    byItem.set(key, {
      items: r.items,
      price: Math.max(prev?.price || 0, r.price || 0),
      original_price: Math.max(prev?.original_price || 0, r.original_price || 0),
      markup: Math.max(prev?.markup || 0, r.markup || 0),
      quantity: Number((prev?.quantity || 0) + (r.quantity || 0)),
      amount: Number((prev?.amount || 0) + (r.amount || 0)),
      category: prev?.category ?? r.category ?? null
    })
  }

  return Array.from(byItem.values())
}

// Returns aggregated items demand by delivery branch (branch_code) and department_id
export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const branchCode = (searchParams.get('branch') || '').trim()
    const departmentId = searchParams.get('department_id')

    const { error: ordersColErr } = await supabase.from('orders').select('cycle_id').limit(1)
    const { error: pricesColErr } = await supabase.from('branch_item_prices').select('cycle_id').limit(1)
    const { error: markupsColErr } = await supabase.from('branch_item_markups').select('cycle_id').limit(1)
    const ordersHasCycle = !ordersColErr
    const pricesHasCycle = !pricesColErr
    const markupsHasCycle = !markupsColErr

    let activeCycleId = null
    if (ordersHasCycle || pricesHasCycle || markupsHasCycle) {
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('cycles')
        .select('id')
        .eq('is_active', true)
        .maybeSingle()
      if (cycleErr) throw new Error(cycleErr.message)
      activeCycleId = activeCycle?.id || null
      if (!activeCycleId) {
        // Closed season: report on the newest cycle that has orders.
        const { data: latestCycle } = await supabase
          .from('orders')
          .select('cycle_id')
          .not('cycle_id', 'is', null)
          .order('order_id', { ascending: false })
          .limit(1)
          .maybeSingle()
        activeCycleId = latestCycle?.cycle_id || null
      }
      if (!activeCycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
    }

    // Primary path: direct SQL across core tables with prices and configured markups
    try {
      const whereClauses = ["o.status::text IN ('Pending','Posted','Delivered')"]
      const params = []
      if (branchCode) { whereClauses.push('b.code = $1'); params.push(branchCode) }
      if (departmentId) { const idx = params.length + 1; whereClauses.push(`d.id = $${idx}`); params.push(Number(departmentId)) }
      if (ordersHasCycle) { const idx = params.length + 1; whereClauses.push(`o.cycle_id = $${idx}`); params.push(Number(activeCycleId)) }

      // If no department filter, aggregate across all departments by item (avoid duplicates)
      const groupByDept = Boolean(departmentId)

      const sql = `
        SELECT 
          ${groupByDept ? 'b.code AS branch_code,' : ''}
          ${groupByDept ? 'b.name AS branch_name,' : ''}
          ${groupByDept ? 'd.id   AS department_id,' : ''}
          ${groupByDept ? 'd.name AS department_name,' : ''}
          i.item_id AS item_id,
          i.name AS item_name,
          i.category AS item_category,
          COALESCE(MAX(bip.price), 0)::numeric AS base_price,
          COALESCE(MAX(CASE WHEN bim.active THEN bim.amount END), 0)::numeric AS markup_amount,
          COALESCE(SUM(ol.qty), 0)::numeric AS total_demand,
          COALESCE(SUM(ol.amount), 0)::numeric AS total_amount_recorded
        FROM orders o
        JOIN order_lines ol ON ol.order_id = o.order_id
        JOIN branches b ON o.delivery_branch_id = b.id
        JOIN items i ON i.item_id = ol.item_id
        LEFT JOIN departments d ON d.id = COALESCE(o.department_id, i.department_id)
        LEFT JOIN branch_item_prices bip ON bip.branch_id = b.id AND bip.item_id = i.item_id
          ${pricesHasCycle ? `AND bip.cycle_id = $${params.length + 1}` : ''}
        LEFT JOIN branch_item_markups bim ON bim.branch_id = b.id AND bim.item_id = i.item_id
          ${markupsHasCycle ? `AND bim.cycle_id = $${pricesHasCycle ? params.length + 2 : params.length + 1}` : ''}
        ${whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : ''}
        GROUP BY ${groupByDept ? 'b.code, b.name, d.id, d.name,' : ''} i.item_id, i.name, i.category
        ORDER BY i.category, i.name
      `

      if (pricesHasCycle) params.push(Number(activeCycleId))
      if (markupsHasCycle) params.push(Number(activeCycleId))
      const result = await queryDirect(sql, params)
      const rows = (result.rows || []).map(r => ({
        items: r.item_name,
        // Keep price for debugging; UI uses original_price + markup to compute amount
        price: Number(r.base_price || 0) + Number(r.markup_amount || 0),
        quantity: Number(r.total_demand || 0),
        amount: Number(r.total_amount_recorded || 0),
        branch_code: r.branch_code,
        branch_name: r.branch_name,
        department_id: r.department_id,
        department_name: r.department_name,
        original_price: Number(r.base_price || 0),
        markup: Number(r.markup_amount || 0),
        category: r.item_category || null
      }))

      if (rows.length) {
        return NextResponse.json({ ok: true, rows })
      }

      // Fallback: aggregate via Supabase tables
      const fallbackRows = await aggregateViaTables(supabase, { branchCode, departmentId, ordersHasCycle, pricesHasCycle, markupsHasCycle, activeCycleId })
      return NextResponse.json({ ok: true, rows: fallbackRows })
    } catch (err) {
      // Fallback if direct SQL fails
      const fallbackRows = await aggregateViaTables(supabase, { branchCode, departmentId, ordersHasCycle, pricesHasCycle, markupsHasCycle, activeCycleId })
      return NextResponse.json({ ok: true, rows: fallbackRows })
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
