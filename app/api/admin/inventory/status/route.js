import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { queryDirect } from '../../../../../lib/directDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

async function resolveCycleId(supabase, searchParams, needsCycle) {
  if (!needsCycle) return null
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
    const ordersHasCycle = await hasColumn(supabase, 'orders', 'cycle_id')
    const pricesHasCycle = await hasColumn(supabase, 'branch_item_prices', 'cycle_id')
    const needsCycle = ordersHasCycle || pricesHasCycle
    const cycleId = await resolveCycleId(supabase, searchParams, needsCycle)
    if (needsCycle && !cycleId) {
      return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
    }

    let bipQ = supabase
      .from('branch_item_prices')
      .select('branch_id, item_id, price, branches:branch_id ( id, code, name ), items:item_id ( item_id, sku, name )')
    if (pricesHasCycle) bipQ = bipQ.eq('cycle_id', cycleId)
    const { data: bipRows, error: bipErr } = await bipQ
    if (bipErr) throw new Error(bipErr.message)

    const priced = bipRows || []
    if (!priced.length) return NextResponse.json({ ok: true, rows: [] })

    const branchIds = [...new Set(priced.map(r => r.branch_id).filter(Boolean))]
    const itemIds = [...new Set(priced.map(r => r.item_id).filter(Boolean))]

    const countsByPair = new Map()
    const hasDirect = !!process.env.SUPABASE_DB_URL
    if (hasDirect) {
      const params = []
      const where = ["o.status::text IN ('Pending','Posted','Delivered')"]
      if (ordersHasCycle) {
        params.push(Number(cycleId))
        where.push(`o.cycle_id = $${params.length}`)
      }
      if (branchIds.length) {
        params.push(branchIds)
        where.push(`o.delivery_branch_id = ANY($${params.length}::bigint[])`)
      }
      if (itemIds.length) {
        params.push(itemIds)
        where.push(`ol.item_id = ANY($${params.length}::bigint[])`)
      }

      const sql = `
        SELECT
          o.delivery_branch_id AS branch_id,
          ol.item_id AS item_id,
          COALESCE(SUM(CASE WHEN o.status = 'Pending' THEN ol.qty ELSE 0 END), 0)::numeric AS pending_qty,
          COALESCE(SUM(CASE WHEN o.status = 'Posted' THEN ol.qty ELSE 0 END), 0)::numeric AS posted_qty,
          COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN ol.qty ELSE 0 END), 0)::numeric AS delivered_qty
        FROM orders o
        JOIN order_lines ol ON ol.order_id = o.order_id
        WHERE ${where.join(' AND ')}
        GROUP BY o.delivery_branch_id, ol.item_id
      `

      const result = await queryDirect(sql, params)
      for (const r of (result?.rows || [])) {
        const key = `${r.branch_id}:${r.item_id}`
        countsByPair.set(key, {
          pending: Number(r.pending_qty || 0),
          posted: Number(r.posted_qty || 0),
          delivered: Number(r.delivered_qty || 0)
        })
      }
    } else {
      let ordersQ = supabase
        .from('orders')
        .select('order_id, status, delivery_branch_id')
        .in('status', ['Pending', 'Posted', 'Delivered'])
        .in('delivery_branch_id', branchIds)
      if (ordersHasCycle) ordersQ = ordersQ.eq('cycle_id', cycleId)
      const { data: orders, error: oErr } = await ordersQ
      if (oErr) throw new Error(oErr.message)
      if (orders?.length) {
        const orderById = new Map((orders || []).map(o => [o.order_id, { status: o.status, branch_id: o.delivery_branch_id }]))
        const orderIds = orders.map(o => o.order_id)
        const { data: lines, error: lErr } = await supabase
          .from('order_lines')
          .select('order_id, item_id, qty')
          .in('order_id', orderIds)
          .in('item_id', itemIds)
        if (lErr) throw new Error(lErr.message)

        for (const l of (lines || [])) {
          const o = orderById.get(l.order_id)
          if (!o) continue
          const key = `${o.branch_id}:${l.item_id}`
          const cur = countsByPair.get(key) || { pending: 0, posted: 0, delivered: 0 }
          if (o.status === 'Pending') cur.pending += Number(l.qty || 0)
          else if (o.status === 'Posted') cur.posted += Number(l.qty || 0)
          else if (o.status === 'Delivered') cur.delivered += Number(l.qty || 0)
          countsByPair.set(key, cur)
        }
      }
    }

    const rows = priced.map(r => {
      const key = `${r.branch_id}:${r.item_id}`
      const c = countsByPair.get(key) || { pending: 0, posted: 0, delivered: 0 }
      const pending = Number(c.pending || 0)
      const confirmed = Number(c.posted || 0)
      const delivered = Number(c.delivered || 0)
      return {
        branch_code: r.branches?.code || null,
        branch_name: r.branches?.name || null,
        item_id: r.item_id,
        sku: r.items?.sku || null,
        item_name: r.items?.name || null,
        price: Number(r.price || 0),
        pending_demand: pending,
        confirmed_demand: confirmed,
        delivered_qty: delivered,
        total_demand: pending + confirmed + delivered
      }
    })

    rows.sort((a, b) => (a.branch_name || '').localeCompare(b.branch_name || '') || (a.item_name || '').localeCompare(b.item_name || ''))
    return NextResponse.json({ ok: true, rows })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
