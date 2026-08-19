// app/api/rep/exhibition/orders/audit/route.js
// GET /api/rep/exhibition/orders/audit?order_id=NNN
// Returns the audit trail for one exhibition order at the rep's branch —
// who approved / cancelled / restored / delivered it and when. Scoped to the
// rep's branch so a rep can only inspect their own branch's orders. Reads the
// shared audit_log table (rows tagged module='exhibition'), the same trail the
// admin audit views and the food/ram modules use.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getRepBranch } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const auth = getRepBranch(req)
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

    const orderDbId = Math.trunc(Number(new URL(req.url).searchParams.get('order_id') || 0))
    if (!Number.isFinite(orderDbId) || orderDbId <= 0) {
      return NextResponse.json({ ok: false, error: 'order_id is required' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: order } = await supabase
      .from('exhibition_orders')
      .select('id, order_id')
      .eq('id', orderDbId)
      .eq('branch_id', auth.branchId)
      .maybeSingle()
    if (!order) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    const { data: rows, error } = await supabase
      .from('audit_log')
      .select('id, actor, action, detail, created_at')
      .eq('module', 'exhibition')
      .eq('order_id', String(orderDbId))
      .order('created_at', { ascending: true })
    if (error) {
      // Audit table not migrated yet — return an empty trail rather than fail.
      return NextResponse.json({ ok: true, order_id: order.order_id, events: [] })
    }

    const events = (rows || []).map((r) => {
      const detail = r.detail || {}
      return {
        id: r.id,
        action: r.action,
        actor_type: String(detail.actor_type || ''),
        actor_label: String(r.actor || ''),
        note: String(detail.note || '').trim(),
        created_at: r.created_at,
      }
    })

    return NextResponse.json({ ok: true, order_id: order.order_id, events })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load audit trail' }, { status: 500 })
  }
}
