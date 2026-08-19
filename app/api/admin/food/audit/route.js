// app/api/admin/food/audit/route.js
// Admin view of the food order audit trail, read from the shared audit_log
// table (rows tagged module='food'). Mirrors the exhibition audit lens: the
// superuser view of every post / deliver / rollback event across all branches,
// with order context (member, branch, cycle, status, total) resolved from the
// orders table.
//   GET /api/admin/food/audit?action=&branch_id=&q=&limit=&offset=
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = ['post', 'deliver', 'rollback']
// orders has FKs to branches but NOT to cycles — fetch cycle names separately.
const ORDER_SELECT = 'order_id, member_id, member_name_snapshot, status, total_amount, cycle_id, branches:branch_id(id, name, code)'

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)

    const action = (searchParams.get('action') || '').trim().toLowerCase()
    const branchId = Math.trunc(Number(searchParams.get('branch_id') || 0))
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    // audit_log rows carry the business order_id — resolve matching orders first
    // so filters apply to both the audit rows and the context join.
    let orderQ = supabase.from('orders').select('order_id')
    if (branchId > 0) orderQ = orderQ.or(`branch_id.eq.${branchId},delivery_branch_id.eq.${branchId}`)
    if (q) orderQ = orderQ.or(`order_id.ilike.%${q}%,member_id.ilike.%${q}%,member_name_snapshot.ilike.%${q}%`)
    const { data: matched, error: mErr } = await orderQ
    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 })
    const orderIds = (matched || []).map((o) => String(o.order_id))
    if (!orderIds.length) {
      return NextResponse.json({ ok: true, events: [], total: 0, branches: [] })
    }

    let countQ = supabase.from('audit_log').select('id', { count: 'exact', head: true }).eq('module', 'food').in('order_id', orderIds)
    if (action && ACTIONS.includes(action)) countQ = countQ.eq('action', action)
    const { count } = await countQ

    let query = supabase
      .from('audit_log')
      .select('id, actor, action, order_id, detail, created_at')
      .eq('module', 'food')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (action && ACTIONS.includes(action)) query = query.eq('action', action)
    const { data, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Resolve order context in one pass (audit_log has no FK to orders).
    const uniqueOrderIds = [...new Set((data || []).map((e) => e.order_id))]
    const { data: orders } = uniqueOrderIds.length
      ? await supabase.from('orders').select(ORDER_SELECT).in('order_id', uniqueOrderIds)
      : { data: [] }
    const orderMap = new Map((orders || []).map((o) => [String(o.order_id), o]))

    // orders has no FK to cycles — resolve cycle names in a second call.
    const cycleIds = [...new Set((orders || []).map((o) => o.cycle_id).filter(Boolean))]
    const { data: cycleRows } = cycleIds.length
      ? await supabase.from('cycles').select('id, name').in('id', cycleIds)
      : { data: [] }
    const cycleMap = new Map((cycleRows || []).map((c) => [Number(c.id), c.name || '']))

    const events = (data || []).map((e) => {
      const o = orderMap.get(e.order_id) || {}
      const detail = e.detail || {}
      const note =
        e.action === 'rollback'
          ? `${detail.from || ''} → ${detail.to || ''}${detail.note ? ` · ${detail.note}` : ''}`
          : e.action === 'deliver'
            ? `Delivered by ${detail.deliveredBy || e.actor}`
            : detail.adminNote || ''
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
          member_name_snapshot: o.member_name_snapshot,
          status: o.status,
          total_amount: o.total_amount,
          branch_name: o.branches?.name || '',
          branch_code: o.branches?.code || '',
          cycle_name: cycleMap.get(Number(o.cycle_id)) || '',
        },
      }
    })

    // Branch filter options (all branches that have food orders).
    const { data: branchRows } = await supabase
      .from('orders')
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
