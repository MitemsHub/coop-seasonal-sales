import { createClient } from '../../../../../lib/supabaseServer'
import { NextResponse } from 'next/server'

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
    const itemFilter = (searchParams.get('item') || '').trim()
    const pageParam = Number(searchParams.get('page') || 1)
    const pageSizeParam = Number(searchParams.get('pageSize') || 25)
    const hasPaging = searchParams.has('pageSize') || searchParams.has('page')
    const ordersHasCycle = await hasColumn(supabase, 'orders', 'cycle_id')
    const cycleId = await resolveCycleId(supabase, searchParams, ordersHasCycle)
    if (ordersHasCycle && !cycleId) {
      return NextResponse.json({ ok: false, error: 'No active cycle found', data: [] }, { status: 200 })
    }

    // Try primary view first
    const viewHasCycle = ordersHasCycle && (await hasColumn(supabase, 'v_inventory_status', 'cycle_id'))
    let viewQ = supabase.from('v_inventory_status').select('*').order('item_name', { ascending: true })
    if (viewHasCycle) viewQ = viewQ.eq('cycle_id', cycleId)
    const { data: viewRows, error: viewError } = await viewQ

    if (viewError || !viewRows || viewRows.length === 0 || (ordersHasCycle && !viewHasCycle)) {
      // Fallback aggregation from base tables to avoid hard failures or empty views
      let ordersQ = supabase.from('orders').select('order_id, status').in('status', ['Pending', 'Posted', 'Delivered'])
      if (ordersHasCycle) ordersQ = ordersQ.eq('cycle_id', cycleId)
      const [ordersRes, linesRes, itemsRes] = await Promise.all([
        ordersQ,
        supabase.from('order_lines').select('order_id, item_id, qty'),
        supabase.from('items').select('item_id, sku, name')
      ])

      if (ordersRes.error || linesRes.error || itemsRes.error) {
        const msg = ordersRes.error?.message || linesRes.error?.message || itemsRes.error?.message || 'Fallback aggregation failed'
        return NextResponse.json({ ok: false, error: msg, data: [] }, { status: 200 })
      }

      const orderStatusMap = new Map((ordersRes.data || []).map(o => [o.order_id, o.status]))
      const itemMeta = new Map((itemsRes.data || []).map(i => [i.item_id, i]))

      const aggByItem = new Map()
      for (const line of (linesRes.data || [])) {
        const status = orderStatusMap.get(line.order_id)
        if (!status) continue
        const key = line.item_id
        const entry = aggByItem.get(key) || { item_id: key, pending_qty: 0, posted_qty: 0, delivered_qty: 0 }
        if (status === 'Pending') entry.pending_qty += Number(line.qty || 0)
        else if (status === 'Posted') entry.posted_qty += Number(line.qty || 0)
        else if (status === 'Delivered') entry.delivered_qty += Number(line.qty || 0)
        aggByItem.set(key, entry)
      }

      let rows = Array.from(aggByItem.values()).map(r => {
        const meta = itemMeta.get(r.item_id) || {}
        const allocated = (r.pending_qty || 0) + (r.posted_qty || 0)
        return {
          item_id: r.item_id,
          item_name: meta.name || meta.sku || `Item ${r.item_id}`,
          sku: meta.sku || null,
          pending_demand: r.pending_qty || 0,
          confirmed_demand: r.posted_qty || 0,
          delivered_qty: r.delivered_qty || 0,
          total_demand: allocated + (r.delivered_qty || 0),
          allocated_qty: allocated,
          pending_delivery_qty: r.posted_qty || 0,
        }
      })

      // Include zero-demand items for completeness
      for (const [id, meta] of itemMeta.entries()) {
        if (!aggByItem.has(id)) {
          rows.push({
            item_id: id,
            item_name: meta.name || meta.sku || `Item ${id}`,
            sku: meta.sku || null,
            pending_demand: 0,
            confirmed_demand: 0,
            delivered_qty: 0,
            total_demand: 0,
            allocated_qty: 0,
            pending_delivery_qty: 0,
          })
        }
      }

      if (itemFilter) {
        const q = itemFilter.toLowerCase()
        rows = rows.filter(r => (r.item_name || '').toLowerCase().includes(q) || (r.sku || '').toLowerCase().includes(q))
      }

      // Only paginate if explicitly requested
      if (hasPaging) {
        const start = (pageParam - 1) * pageSizeParam
        const end = start + pageSizeParam
        const paged = rows.slice(start, end)
        return NextResponse.json({ ok: true, data: paged, total: rows.length })
      }
      return NextResponse.json({ ok: true, data: rows, total: rows.length })
    }

    // View returned rows
    let rows = viewRows
    // Aggregate by item across branches
    const agg = new Map()
    for (const r of rows) {
      const id = r.item_id ?? null
      if (!id) continue
      const entry = agg.get(id) || { item_id: id, item_name: r.item_name || r.sku || `Item ${id}`, sku: r.sku || null, pending: 0, posted: 0, delivered: 0 }
      const pending = Number(r.pending_demand ?? ((r.allocated_qty || 0) - (r.pending_delivery_qty || 0)) ?? 0)
      const posted = Number(r.confirmed_demand ?? r.pending_delivery_qty ?? 0)
      const delivered = Number(r.delivered_qty ?? r.delivered_demand ?? 0)
      entry.pending += pending
      entry.posted += posted
      entry.delivered += delivered
      agg.set(id, entry)
    }
    rows = Array.from(agg.values()).map(e => ({
      item_id: e.item_id,
      item_name: e.item_name,
      sku: e.sku,
      pending_demand: e.pending,
      confirmed_demand: e.posted,
      delivered_qty: e.delivered,
      total_demand: e.pending + e.posted + e.delivered,
      allocated_qty: e.pending + e.posted,
      pending_delivery_qty: e.posted,
    }))

    // Include zero-demand items missing from the view
    const { data: itemsAll } = await supabase.from('items').select('item_id, sku, name')
    const present = new Set(rows.map(r => r.item_id))
    for (const meta of (itemsAll || [])) {
      if (!present.has(meta.item_id)) {
        rows.push({
          item_id: meta.item_id,
          item_name: meta.name || meta.sku || `Item ${meta.item_id}`,
          sku: meta.sku || null,
          pending_demand: 0,
          confirmed_demand: 0,
          delivered_qty: 0,
          total_demand: 0,
          allocated_qty: 0,
          pending_delivery_qty: 0,
        })
      }
    }
    if (itemFilter) {
      const q = itemFilter.toLowerCase()
      rows = rows.filter(r => (r.item_name || '').toLowerCase().includes(q) || (r.sku || '').toLowerCase().includes(q))
    }

    // Only paginate if explicitly requested
    if (hasPaging) {
      const start = (pageParam - 1) * pageSizeParam
      const end = start + pageSizeParam
      const paged = rows.slice(start, end)
      return NextResponse.json({ ok: true, data: paged, total: rows.length })
    }
    return NextResponse.json({ ok: true, data: rows, total: rows.length })
  } catch (error) {
    console.error('API error (items inventory):', error)
    return NextResponse.json({ ok: false, error: error.message || 'Internal server error', data: [] })
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true })
}
