// app/api/admin/exhibition/audit/route.js
// Admin view of the exhibition order audit trail, read from the shared
// audit_log table (rows tagged module='exhibition') — the same table the
// food and ram modules use, so all three modules share one trail. Unlike the
// rep route (which is scoped to one branch and one order), this is the
// superuser lens: every branch's events — who approved / cancelled / restored
// / delivered each order and when — with order context (member, branch,
// cycle, status, total) resolved from the exhibition_orders table.
//   GET /api/admin/exhibition/audit?order_id=NNN            → one order's trail
//   GET /api/admin/exhibition/audit?action=&branch_id=&q=&limit=&offset=
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = ['Approved', 'Cancelled', 'Restored', 'Delivered']

// exhibition_orders has FKs to branches AND cycles — both embeds resolve.
const ORDER_SELECT =
  'id, order_id, member_id, member_name_snapshot, status, total_amount, cycle_id, branch_id, branches:branch_id(name, code), cycles:cycle_id(name, code)'

// audit_log stores { actor, action, detail }; the exhibition UI reads
// actor_label / actor_type / note — map to that shape here.
function mapEvent(e) {
  const detail = e.detail || {}
  return {
    id: e.id,
    action: e.action,
    actor_type: String(detail.actor_type || ''),
    actor_label: String(e.actor || ''),
    note: String(detail.note || '').trim(),
    created_at: e.created_at,
  }
}

function orderContext(o) {
  if (!o) return {}
  return {
    id: o.id,
    order_id: o.order_id,
    member_id: o.member_id,
    member_name_snapshot: o.member_name_snapshot,
    status: o.status,
    total_amount: o.total_amount,
    branch_name: o.branches?.name || '',
    branch_code: o.branches?.code || '',
    cycle_name: o.cycles?.name || '',
    cycle_code: o.cycles?.code || '',
  }
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)

    // One order's full trail (the admin equivalent of the rep per-order view).
    const orderDbId = Math.trunc(Number(searchParams.get('order_id') || 0))
    if (Number.isFinite(orderDbId) && orderDbId > 0) {
      const { data: order } = await supabase.from('exhibition_orders').select(ORDER_SELECT).eq('id', orderDbId).maybeSingle()
      if (!order) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
      const { data: events, error } = await supabase
        .from('audit_log')
        .select('id, actor, action, detail, created_at')
        .eq('module', 'exhibition')
        .eq('order_id', String(orderDbId))
        .order('created_at', { ascending: true })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, order: orderContext(order), events: (events || []).map(mapEvent) })
    }

    // Otherwise: paginated feed across all branches with filters.
    const action = (searchParams.get('action') || '').trim()
    const branchId = Math.trunc(Number(searchParams.get('branch_id') || 0))
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    // audit_log rows carry the internal order id as text — resolve matching
    // exhibition orders first so filters apply to both the audit rows and the
    // context join.
    let orderQ = supabase.from('exhibition_orders').select('id')
    if (branchId > 0) orderQ = orderQ.eq('branch_id', branchId)
    if (q) orderQ = orderQ.or(`order_id.ilike.%${q}%,member_id.ilike.%${q}%,member_name_snapshot.ilike.%${q}%`)
    const { data: matched, error: mErr } = await orderQ
    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 })
    const orderIds = (matched || []).map((o) => String(o.id))
    if (!orderIds.length) {
      return NextResponse.json({ ok: true, events: [], total: 0, branches: [] })
    }

    let countQ = supabase
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('module', 'exhibition')
      .in('order_id', orderIds)
    if (action && ACTIONS.includes(action)) countQ = countQ.eq('action', action)
    const { count } = await countQ

    let query = supabase
      .from('audit_log')
      .select('id, actor, action, order_id, detail, created_at')
      .eq('module', 'exhibition')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (action && ACTIONS.includes(action)) query = query.eq('action', action)
    const { data, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Resolve order context in one pass (audit_log has no FK to exhibition_orders).
    const uniqueOrderIds = [...new Set((data || []).map((e) => e.order_id))]
    const { data: orders } = uniqueOrderIds.length
      ? await supabase.from('exhibition_orders').select(ORDER_SELECT).in('id', uniqueOrderIds)
      : { data: [] }
    const orderMap = new Map((orders || []).map((o) => [String(o.id), o]))

    const events = (data || []).map((e) => ({
      ...mapEvent(e),
      order: orderContext(orderMap.get(e.order_id)),
    }))

    // Branch filter options for the page (all branches with exhibition orders).
    const { data: branchRows } = await supabase
      .from('exhibition_orders')
      .select('branches:branch_id(id, name, code)')
      .not('branch_id', 'is', null)
    const seen = new Map()
    for (const r of branchRows || []) {
      const b = r.branches
      if (b?.id) seen.set(Number(b.id), { id: Number(b.id), name: b.name || '', code: b.code || '' })
    }

    return NextResponse.json({ ok: true, events, total: count || 0, branches: [...seen.values()] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load audit log' }, { status: 500 })
  }
}
