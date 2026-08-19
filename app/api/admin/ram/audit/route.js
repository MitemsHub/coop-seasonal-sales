// app/api/admin/ram/audit/route.js
// Admin view of the ram order audit trail, read from the shared audit_log
// table (rows tagged module='ram'). Mirrors the exhibition audit lens: the
// superuser view of every approve / cancel / restore / deliver event across
// all hubs, with order context (member, hub, cycle, status, total) resolved
// from ram_orders.
//   GET /api/admin/ram/audit?action=&location_id=&q=&limit=&offset=
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = ['approve', 'cancel', 'restore', 'deliver']

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)

    const action = (searchParams.get('action') || '').trim().toLowerCase()
    const locationId = Math.trunc(Number(searchParams.get('location_id') || 0))
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    // Ram audit rows store order_id as String(ram_orders.id) — resolve matching
    // ram orders first so filters apply to both the audit rows and the join.
    let orderQ = supabase.from('ram_orders').select('id, member_id')
    if (locationId > 0) orderQ = orderQ.eq('ram_delivery_location_id', locationId)
    if (q) orderQ = orderQ.or(`member_id.ilike.%${q}%,id::text.ilike.%${q}%`)
    const { data: matched, error: mErr } = await orderQ
    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 })
    const orderIds = (matched || []).map((o) => String(o.id))
    if (!orderIds.length) {
      return NextResponse.json({ ok: true, events: [], total: 0, locations: [] })
    }

    let countQ = supabase.from('audit_log').select('id', { count: 'exact', head: true }).eq('module', 'ram').in('order_id', orderIds)
    if (action && ACTIONS.includes(action)) countQ = countQ.eq('action', action)
    const { count } = await countQ

    let query = supabase
      .from('audit_log')
      .select('id, actor, action, order_id, detail, created_at')
      .eq('module', 'ram')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (action && ACTIONS.includes(action)) query = query.eq('action', action)
    const { data, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Resolve order context in one pass (audit_log has no FK to ram_orders).
    const uniqueOrderIds = [...new Set((data || []).map((e) => Number(e.order_id)))].filter((n) => Number.isFinite(n) && n > 0)
    const { data: orders } = uniqueOrderIds.length
      ? await supabase.from('ram_orders').select('id, member_id, status, total_amount, ram_cycle_id, ram_delivery_location_id').in('id', uniqueOrderIds)
      : { data: [] }
    const orderMap = new Map((orders || []).map((o) => [String(o.id), o]))

    // Resolve member names + hub names + cycle names for the context columns.
    const memberIds = [...new Set((orders || []).map((o) => o.member_id).filter(Boolean))]
    const hubIds = [...new Set((orders || []).map((o) => o.ram_delivery_location_id).filter(Boolean))]
    const cycleIds = [...new Set((orders || []).map((o) => o.ram_cycle_id).filter(Boolean))]

    const [{ data: members }, { data: hubs }, { data: cycles }] = await Promise.all([
      memberIds.length ? supabase.from('members').select('member_id, full_name').in('member_id', memberIds) : Promise.resolve({ data: [] }),
      hubIds.length ? supabase.from('ram_delivery_locations').select('id, name, delivery_location').in('id', hubIds) : Promise.resolve({ data: [] }),
      cycleIds.length ? supabase.from('ram_cycles').select('id, name').in('id', cycleIds) : Promise.resolve({ data: [] }),
    ])
    const memberMap = new Map((members || []).map((m) => [String(m.member_id), m.full_name || '']))
    const hubMap = new Map((hubs || []).map((h) => [Number(h.id), h.name || h.delivery_location || '']))
    const cycleMap = new Map((cycles || []).map((c) => [Number(c.id), c.name || '']))

    const events = (data || []).map((e) => {
      const o = orderMap.get(e.order_id) || {}
      const detail = e.detail || {}
      const note =
        e.action === 'cancel'
          ? detail.reason || ''
          : e.action === 'restore'
            ? 'Restored to Pending'
            : e.action === 'approve'
              ? 'Order approved'
              : ''
      return {
        id: e.id,
        actor: e.actor,
        action: e.action,
        order_id: e.order_id,
        note,
        created_at: e.created_at,
        order: {
          order_id: e.order_id,
          member_id: o.member_id,
          member_name_snapshot: memberMap.get(String(o.member_id)) || '',
          status: o.status,
          total_amount: o.total_amount,
          hub_name: hubMap.get(Number(o.ram_delivery_location_id)) || '',
          cycle_name: cycleMap.get(Number(o.ram_cycle_id)) || '',
        },
      }
    })

    // Hub filter options (all hubs that have ram orders).
    const { data: locationRows } = await supabase
      .from('ram_orders')
      .select('ram_delivery_location_id')
      .not('ram_delivery_location_id', 'is', null)
    const seen = new Map()
    for (const r of locationRows || []) {
      const id = Number(r.ram_delivery_location_id)
      const label = hubMap.get(id) || ''
      if (id && label) seen.set(id, { id, name: label })
    }

    return NextResponse.json({ ok: true, events, total: count || 0, locations: [...seen.values()] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load audit log' }, { status: 500 })
  }
}
