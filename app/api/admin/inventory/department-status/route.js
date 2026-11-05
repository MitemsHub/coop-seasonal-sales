import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

async function resolveCycleId(supabase, searchParams, ordersHasCycle) {
  if (!ordersHasCycle) return null
  const raw = searchParams.get('cycle_id')
  if (raw != null && raw !== '') {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) throw new Error('Invalid cycle_id')
    return parsed
  }
  const { data, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.id) return data.id
    // A closed season must not block this screen: fall back to the newest
    // cycle that actually has orders (lib/orderCycle does the same for lists).
    const { data: latestCycle } = await supabase
      .from('orders')
      .select('cycle_id')
      .not('cycle_id', 'is', null)
      .order('order_id', { ascending: false })
      .limit(1)
      .maybeSingle()
    return latestCycle?.cycle_id ?? null
}

export async function GET(request) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const branch = searchParams.get('branch')
    const department = searchParams.get('department')

    const ordersHasCycle = await hasColumn(supabase, 'orders', 'cycle_id')
    const cycleId = await resolveCycleId(supabase, searchParams, ordersHasCycle)
    if (ordersHasCycle && !cycleId) {
      return NextResponse.json({ data: [], error: 'No active cycle found' }, { status: 200 })
    }

    // Always aggregate using orders.department_id and orders.delivery_branch_id
    let ordersQ = supabase.from('orders').select('order_id, status, delivery_branch_id, department_id')
    if (ordersHasCycle) ordersQ = ordersQ.eq('cycle_id', cycleId)
    const [ordersRes, linesRes, itemsRes, deptsRes, branchesRes] = await Promise.all([
      ordersQ,
      supabase.from('order_lines').select('order_id, item_id, qty'),
      supabase.from('items').select('item_id, sku, name'),
      supabase.from('departments').select('id, name'),
      supabase.from('branches').select('id, code, name')
    ])
    if (ordersRes.error || linesRes.error || itemsRes.error || deptsRes.error || branchesRes.error) {
      const msg = ordersRes.error?.message || linesRes.error?.message || itemsRes.error?.message || deptsRes.error?.message || branchesRes.error?.message || 'Aggregation failed'
      return NextResponse.json({ data: [], error: msg }, { status: 200 })
    }
    const orderInfo = new Map(ordersRes.data.map(o => [o.order_id, { status: o.status, branch_id: o.delivery_branch_id, department_id: o.department_id }]))
    const deptMap = new Map(deptsRes.data.map(d => [d.id, d.name]))
    const branchMap = new Map(branchesRes.data.map(b => [b.id, { code: b.code, name: b.name }]))
    const itemMeta = new Map(itemsRes.data.map(i => [i.item_id, i]))
    const agg = new Map()
    for (const line of linesRes.data) {
      const ord = orderInfo.get(line.order_id)
      if (!ord) continue
      const brId = ord.branch_id
      const depId = ord.department_id
      const key = `${brId}|${depId}|${line.item_id}`
      const entry = agg.get(key) || { branch_id: brId, department_id: depId, item_id: line.item_id, pending_qty: 0, posted_qty: 0, delivered_qty: 0 }
      const st = String(ord.status || '').toLowerCase()
      if (st === 'pending') entry.pending_qty += line.qty || 0
      else if (st === 'posted') entry.posted_qty += line.qty || 0
      else if (st === 'delivered') entry.delivered_qty += line.qty || 0
      agg.set(key, entry)
    }
    let rows = Array.from(agg.values()).map(r => {
      const b = branchMap.get(r.branch_id) || {}
      const dname = deptMap.get(r.department_id) || 'Unknown Department'
      const meta = itemMeta.get(r.item_id) || {}
      const pending = r.pending_qty || 0
      const confirmed = r.posted_qty || 0
      const delivered = r.delivered_qty || 0
      const allocated = pending + confirmed
      return {
        // identifiers for React key stability
        branch_id: r.branch_id,
        department_id: r.department_id,
        item_id: r.item_id,
        branch_code: b.code || 'N/A',
        branch_name: b.name || 'Unknown Branch',
        department_name: dname,
        sku: meta.sku || null,
        item_name: meta.name || `Item ${r.item_id}`,
        pending_demand: pending,
        confirmed_demand: confirmed,
        delivered_qty: delivered,
        total_demand: allocated + delivered,
        allocated_qty: allocated,
        pending_delivery_qty: confirmed
      }
    })
    // Apply filters
    if (branch && branch !== 'All Branches') rows = rows.filter(r => r.branch_code === branch || r.branch_name === branch)
    if (department && department !== 'All Departments') rows = rows.filter(r => r.department_name === department)
    // Exclude branches with zero activity (no orders at all)
    rows = rows.filter(r => (r.total_demand || 0) > 0 || (r.allocated_qty || 0) > 0 || (r.pending_delivery_qty || 0) > 0 || (r.delivered_qty || 0) > 0)
    // Order
    rows.sort((a,b) => (a.branch_name||'').localeCompare(b.branch_name||'') || (a.department_name||'').localeCompare(b.department_name||'') || (a.item_name||'').localeCompare(b.item_name||''))
    return NextResponse.json({ data: rows, summary: { total_items: rows.length } })
  
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// OPTIONS endpoint for fetching available departments and branches
export async function OPTIONS() {
  try {
    const supabase = createClient()
    
    // Fetch departments
    const { data: departments, error: deptError } = await supabase
      .from('departments')
      .select('id, name')
      .order('name')
    
    if (deptError) {
      throw deptError
    }
    
    // Fetch branches
    const { data: branches, error: branchError } = await supabase
      .from('branches')
      .select('id, code, name')
      .order('name')
    
    if (branchError) {
      throw branchError
    }
    
    return NextResponse.json({
      departments: departments || [],
      branches: branches || []
    })
    
  } catch (error) {
    console.error('Error fetching departments and branches:', error)
    return NextResponse.json(
      { error: 'Failed to fetch departments and branches' },
      { status: 500 }
    )
  }
}
