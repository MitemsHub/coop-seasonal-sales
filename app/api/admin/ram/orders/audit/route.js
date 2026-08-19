// app/api/admin/ram/orders/audit/route.js
// GET /api/admin/ram/orders/audit?order_id=NNN
// Returns the audit trail for one ram order — who approved / cancelled /
// restored / delivered it and when — read from the shared audit_log table
// (rows tagged module='ram', order_id = String(ram_orders.id)). Mirrors the
// exhibition per-order audit endpoint so the Activity modal renders the same
// timeline on both modules.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// audit_log actions are lowercase; the timeline vocabulary matches exhibition.
const ACTION_LABEL = {
  approve: 'Approved',
  cancel: 'Cancelled',
  restore: 'Restored',
  deliver: 'Delivered',
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const orderId = Math.trunc(Number(new URL(req.url).searchParams.get('order_id') || 0))
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ ok: false, error: 'order_id is required' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: order } = await supabase
      .from('ram_orders')
      .select('id, member_id, status, total_amount, created_at, ram_delivery_location_id')
      .eq('id', orderId)
      .maybeSingle()
    if (!order) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    // Resolve the member name for the order context (ram_orders has no snapshot).
    let memberName = ''
    if (order.member_id) {
      const { data: member } = await supabase
        .from('members')
        .select('full_name')
        .eq('member_id', order.member_id)
        .maybeSingle()
      memberName = member?.full_name || ''
    }

    // Audit trail for this order, oldest first (the timeline reads top-down).
    const { data: rows, error } = await supabase
      .from('audit_log')
      .select('id, actor, action, detail, created_at')
      .eq('module', 'ram')
      .eq('order_id', String(orderId))
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const events = (rows || []).map((r) => {
      const detail = r.detail || {}
      return {
        id: r.id,
        action: ACTION_LABEL[r.action] || r.action,
        actor_label: String(r.actor || 'Unknown'),
        note: String(detail.reason || detail.note || '').trim(),
        created_at: r.created_at,
      }
    })

    return NextResponse.json({
      ok: true,
      order: {
        id: Number(order.id),
        member_id: order.member_id,
        member_name_snapshot: memberName,
        status: order.status,
        total_amount: order.total_amount,
        created_at: order.created_at,
      },
      events,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load audit trail' }, { status: 500 })
  }
}
