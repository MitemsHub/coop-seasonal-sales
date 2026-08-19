// app/api/vendor/exhibition/orders/audit/route.js
// GET /api/vendor/exhibition/orders/audit?order_id=NNN
// Returns the audit trail for one exhibition order — who approved / cancelled
// / restored / delivered it and when — so vendors can see the history behind
// an order they marked delivered. Reads the shared audit_log table (rows
// tagged module='exhibition'), the same trail the rep and admin audit views
// use. Scoped to the vendor: the order must contain at least one line from
// this vendor's stand.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const orderDbId = Math.trunc(Number(new URL(req.url).searchParams.get('order_id') || 0))
    if (!Number.isFinite(orderDbId) || orderDbId <= 0) {
      return NextResponse.json({ ok: false, error: 'order_id is required' }, { status: 400 })
    }

    const supabase = createClient()

    // The order must contain one of this vendor's lines (stand-scoped).
    const { data: line, error: lineErr } = await supabase
      .from('exhibition_order_lines')
      .select('id, order_id')
      .eq('vendor_id', ctx.vendor_id)
      .eq('order_id', orderDbId)
      .limit(1)
      .maybeSingle()
    if (lineErr) return NextResponse.json({ ok: false, error: lineErr.message }, { status: 500 })
    if (!line) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    const { data: rows, error } = await supabase
      .from('audit_log')
      .select('id, actor, action, detail, created_at')
      .eq('module', 'exhibition')
      .eq('order_id', String(orderDbId))
      .order('created_at', { ascending: true })
    if (error) {
      // Audit table not migrated yet — return an empty trail rather than fail.
      return NextResponse.json({ ok: true, events: [] })
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

    return NextResponse.json({ ok: true, events })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load audit trail' }, { status: 500 })
  }
}
