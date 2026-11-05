// app/api/admin/inventory/delivery-branch-member/route.js
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

// Returns rows aggregated by DELIVERY branch and MEMBER branch with status counts
// Source: v_applications_by_delivery_branch_member_branch
export async function GET(req) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const delivery = (searchParams.get('delivery') || '').trim() // delivery branch name
    const member = (searchParams.get('member') || '').trim()     // member/home branch name

    const ordersHasCycle = await hasColumn(supabase, 'orders', 'cycle_id')
    const cycleId = await resolveCycleId(supabase, searchParams, ordersHasCycle)
    if (ordersHasCycle && !cycleId) {
      return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
    }

    const viewHasCycle = ordersHasCycle && (await hasColumn(supabase, 'v_applications_by_delivery_branch_member_branch', 'cycle_id'))
    if (viewHasCycle) {
      let q = supabase
        .from('v_applications_by_delivery_branch_member_branch')
        .select('*')
        .eq('cycle_id', cycleId)
        .order('delivery_branch_name', { ascending: true })
        .order('branch_name', { ascending: true })

      if (delivery) q = q.eq('delivery_branch_name', delivery)
      if (member) q = q.eq('branch_name', member)

      const { data, error } = await q
      if (error) throw new Error(error.message)

      const rows = (data || []).map(r => ({
        ...r,
        total: Number(r.pending || 0) + Number(r.posted || 0) + Number(r.delivered || 0)
      }))

      return NextResponse.json({ ok: true, data: rows })
    }

    const { data: branches, error: bErr } = await supabase
      .from('branches')
      .select('id, name')
      .order('name')
    if (bErr) throw new Error(bErr.message)

    const branchIdByName = new Map((branches || []).map(b => [b.name, b.id]))
    const branchNameById = new Map((branches || []).map(b => [b.id, b.name]))

    const deliveryIds = delivery ? [branchIdByName.get(delivery)].filter(Boolean) : (branches || []).map(b => b.id)
    const memberIds = member ? [branchIdByName.get(member)].filter(Boolean) : (branches || []).map(b => b.id)

    if (!deliveryIds.length || !memberIds.length) {
      return NextResponse.json({ ok: true, data: [] })
    }

    let ordersQ = supabase
      .from('orders')
      .select('delivery_branch_id, branch_id, status')
      .in('status', ['Pending', 'Posted', 'Delivered'])
      .in('delivery_branch_id', deliveryIds)
      .in('branch_id', memberIds)
    if (ordersHasCycle) ordersQ = ordersQ.eq('cycle_id', cycleId)
    const { data: orders, error: oErr } = await ordersQ
    if (oErr) throw new Error(oErr.message)

    const counts = new Map()
    for (const o of (orders || [])) {
      const key = `${o.delivery_branch_id}:${o.branch_id}`
      const cur = counts.get(key) || { pending: 0, posted: 0, delivered: 0 }
      if (o.status === 'Pending') cur.pending += 1
      else if (o.status === 'Posted') cur.posted += 1
      else if (o.status === 'Delivered') cur.delivered += 1
      counts.set(key, cur)
    }

    const rows = []
    for (const dId of deliveryIds) {
      for (const mId of memberIds) {
        const key = `${dId}:${mId}`
        const c = counts.get(key) || { pending: 0, posted: 0, delivered: 0 }
        rows.push({
          delivery_branch_name: branchNameById.get(dId) || String(dId),
          branch_name: branchNameById.get(mId) || String(mId),
          pending: c.pending,
          posted: c.posted,
          delivered: c.delivered,
          total: c.pending + c.posted + c.delivered
        })
      }
    }

    rows.sort((a, b) => (a.delivery_branch_name || '').localeCompare(b.delivery_branch_name || '') || (a.branch_name || '').localeCompare(b.branch_name || ''))
    return NextResponse.json({ ok: true, data: rows })
  } catch (e) {
    console.error('delivery-branch-member API error:', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
