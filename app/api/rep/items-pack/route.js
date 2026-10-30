// app/api/rep/items-pack/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'
import { verify } from '@/lib/signing'
import { queryDirect } from '../../../../lib/directDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Fallback aggregator using Supabase tables when direct DB URL isn't available
async function aggregateViaTablesForRep(supabase, { branchId, departmentId, ordersHasCycle, pricesHasCycle, markupsHasCycle, activeCycleId }) {
  // Load orders for this rep's branch and status Posted/Delivered (do NOT filter by department here;
  // we'll filter per-line using either order.department_id or item.department_id to avoid misses)
  let ordersQ = supabase
    .from('orders')
    .select('order_id, delivery_branch_id, department_id, status')
    .in('status', ['Posted', 'Delivered'])
    .eq('delivery_branch_id', Number(branchId))
  if (ordersHasCycle) ordersQ = ordersQ.eq('cycle_id', activeCycleId)
  const { data: orders, error: oErr } = await ordersQ
  if (oErr) throw new Error(oErr.message)
  if (!orders?.length) return []

  const orderIds = orders.map(o => o.order_id)

  // Order lines
  const { data: lines, error: lErr } = await supabase
    .from('order_lines')
    .select('order_id, item_id, qty')
    .in('order_id', orderIds)
  if (lErr) throw new Error(lErr.message)
  if (!lines?.length) return []

  // Items metadata
  const itemIdsSet = [...new Set(lines.map(l => l.item_id).filter(Boolean))]
  const { data: items, error: iErr } = await supabase
    .from('items')
    .select('item_id, name, category, department_id')
    .in('item_id', itemIdsSet)
  if (iErr) throw new Error(iErr.message)
  const itemNameById = new Map((items || []).map(i => [i.item_id, i.name]))
  const itemCategoryById = new Map((items || []).map(i => [i.item_id, i.category]))
  const itemDeptById = new Map((items || []).map(i => [i.item_id, i.department_id]))

  // Base prices and active markups for branch+item pairs (only this branch)
  let priceMap = new Map()
  let markupMap = new Map()
  if (itemIdsSet.length) {
    let bipQ = supabase
      .from('branch_item_prices')
      .select('branch_id, item_id, price')
      .eq('branch_id', Number(branchId))
      .in('item_id', itemIdsSet)
    if (pricesHasCycle) bipQ = bipQ.eq('cycle_id', activeCycleId)

    let bimQ = supabase
      .from('branch_item_markups')
      .select('branch_id, item_id, amount, active')
      .eq('branch_id', Number(branchId))
      .in('item_id', itemIdsSet)
    if (markupsHasCycle) bimQ = bimQ.eq('cycle_id', activeCycleId)

    const [{ data: bipData, error: bipErr }, { data: bimData, error: bimErr }] = await Promise.all([bipQ, bimQ])
    if (bipErr) throw new Error(bipErr.message)
    if (bimErr) throw new Error(bimErr.message)
    priceMap = new Map((bipData || []).map(p => [p.item_id, Number(p.price || 0)]))
    markupMap = new Map((bimData || []).filter(m => !!m.active).map(m => [m.item_id, Number(m.amount || 0)]))
  }

  // Aggregate quantity per item
  const orderById = new Map(orders.map(o => [o.order_id, o]))
  const itemAgg = new Map()
  for (const l of lines) {
    const o = orderById.get(l.order_id)
    if (!o) continue
    const itemId = l.item_id
    const includeLine = !departmentId
      || Number(o.department_id || 0) === Number(departmentId)
      || Number(itemDeptById.get(itemId) || 0) === Number(departmentId)
    if (!includeLine) continue
    const prev = itemAgg.get(itemId)
    itemAgg.set(itemId, {
      item_id: itemId,
      quantity: Number((prev?.quantity || 0) + Number(l.qty || 0))
    })
  }

  // Build rows
  const rows = []
  for (const [itemId, agg] of itemAgg.entries()) {
    rows.push({
      items: itemNameById.get(itemId) || String(itemId),
      category: itemCategoryById.get(itemId) || null,
      original_price: Number(priceMap.get(itemId) || 0),
      markup: Number(markupMap.get(itemId) || 0),
      quantity: Number(agg.quantity || 0)
    })
  }

  // Sort by category then item name for consistency
  rows.sort((a, b) => {
    const ca = (a.category || '').toString()
    const cb = (b.category || '').toString()
    if (ca !== cb) return ca.localeCompare(cb)
    return (a.items || '').toString().localeCompare((b.items || '').toString())
  })

  return rows
}

export async function GET(req) {
  try {
    const supabase = createClient()
    const token = req.cookies.get('rep_token')?.value
    const claim = token && verify(token)
    if (!claim || claim.role !== 'rep') {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
    if (claim.module && claim.module !== 'food') {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }
    if (!Number.isFinite(Number(claim.branch_id)) || Number(claim.branch_id) <= 0) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    // A department rep's scope comes from the signed cookie and overrides the
    // query, so the pack can never summarize another department's orders.
    const scopedDeptId = Number(claim.department_id) > 0 ? Number(claim.department_id) : null
    const deptName = scopedDeptId ? '' : (searchParams.get('dept') || '').trim()

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
      if (!activeCycle?.id) {
        return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
      }
      activeCycleId = activeCycle.id
    }

    // Resolve department id: the cookie scope wins, otherwise the query name.
    let deptId = scopedDeptId
    if (!deptId && deptName) {
      const { data, error } = await supabase.from('departments').select('id').eq('name', deptName).single()
      if (error) throw new Error(error.message)
      deptId = data?.id || null
    }

    // Get branch meta for title
    const { data: bMeta, error: bErr } = await supabase.from('branches').select('id, code, name').eq('id', claim.branch_id).single()
    if (bErr) throw new Error(bErr.message)
    const branchName = bMeta?.name || claim.branch_code
    const branchCode = bMeta?.code || claim.branch_code

    // Aggregate per item for this branch and status Posted/Delivered
    try {
      const whereClauses = [ "o.status::text IN ('Posted','Delivered')", 'o.delivery_branch_id = $1' ]
      const params = [ Number(claim.branch_id) ]
      if (deptId) { whereClauses.push(`d.id = $${params.length + 1}`); params.push(Number(deptId)) }
      if (ordersHasCycle) { whereClauses.push(`o.cycle_id = $${params.length + 1}`); params.push(Number(activeCycleId)) }

      const pricesCycleIdx = pricesHasCycle ? params.length + 1 : null
      const markupsCycleIdx = markupsHasCycle ? params.length + (pricesHasCycle ? 2 : 1) : null

      const sql = `
        SELECT 
          i.item_id AS item_id,
          i.name AS item_name,
          i.category AS item_category,
          COALESCE(MAX(bip.price), 0)::numeric AS base_price,
          COALESCE(MAX(CASE WHEN bim.active THEN bim.amount END), 0)::numeric AS markup_amount,
          COALESCE(SUM(ol.qty), 0)::numeric AS total_qty
        FROM orders o
        JOIN order_lines ol ON ol.order_id = o.order_id
        JOIN items i ON i.item_id = ol.item_id
        LEFT JOIN departments d ON d.id = COALESCE(o.department_id, i.department_id)
        LEFT JOIN branch_item_prices bip ON bip.branch_id = o.delivery_branch_id AND bip.item_id = i.item_id
          ${pricesHasCycle ? `AND bip.cycle_id = $${pricesCycleIdx}` : ''}
        LEFT JOIN branch_item_markups bim ON bim.branch_id = o.delivery_branch_id AND bim.item_id = i.item_id
          ${markupsHasCycle ? `AND bim.cycle_id = $${markupsCycleIdx}` : ''}
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY i.item_id, i.name, i.category
        ORDER BY i.category, i.name
      `

      if (pricesHasCycle) params.push(Number(activeCycleId))
      if (markupsHasCycle) params.push(Number(activeCycleId))
      const result = await queryDirect(sql, params)
      const rows = (result.rows || []).map(r => ({
        items: r.item_name,
        category: r.item_category || null,
        original_price: Number(r.base_price || 0),
        markup: Number(r.markup_amount || 0),
        quantity: Number(r.total_qty || 0)
      }))

      if (rows.length) {
        return NextResponse.json({ ok: true, branch: { code: branchCode, name: branchName }, rows })
      }

      // If direct path returns no rows, still fallback for consistency
      const fbRows = await aggregateViaTablesForRep(supabase, { branchId: claim.branch_id, departmentId: deptId, ordersHasCycle, pricesHasCycle, markupsHasCycle, activeCycleId })
      return NextResponse.json({ ok: true, branch: { code: branchCode, name: branchName }, rows: fbRows })
    } catch (err) {
      // Fallback when direct DB URL isn't available or query fails
      const fbRows = await aggregateViaTablesForRep(supabase, { branchId: claim.branch_id, departmentId: deptId, ordersHasCycle, pricesHasCycle, markupsHasCycle, activeCycleId })
      return NextResponse.json({ ok: true, branch: { code: branchCode, name: branchName }, rows: fbRows })
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
