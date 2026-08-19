// app/api/rep/exhibition/orders/cancel/route.js
// Cancel exhibition orders (Pending or Approved) at the rep's branch.
// Body: { ids, reason }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { releaseOrdersStock } from '@/lib/exhibitionStock'
import { buildRepFailed } from '@/lib/exhibitionFailed'
import { getRepBranch } from '../../_session'
import { sanitizeString } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asIdArray(input) {
  if (Array.isArray(input)) return input
  if (input == null) return []
  return [input]
}

export async function POST(req) {
  try {
    const auth = getRepBranch(req)
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

    const body = await req.json().catch(() => ({}))
    const ids = asIdArray(body.ids ?? body.id)
      .map((v) => Math.trunc(Number(v)))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'Invalid order id(s)' }, { status: 400 })

    const reason = sanitizeString(body.reason || '', { maxLength: 300, encodeHtml: false })
    const supabase = createClient()
    const { data: rows, error: selErr } = await supabase
      .from('exhibition_orders')
      .select('id, status, branch_id')
      .in('id', ids)
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })

    const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
    const scoped = ids.filter((id) => Number(byId.get(id)?.branch_id) === auth.branchId)
    const toCancel = scoped.filter((id) => ['Pending', 'Approved'].includes(String(byId.get(id)?.status || '')))
    const failed = buildRepFailed(ids, byId, auth.branchId, new Set(), new Set(toCancel))
    if (!toCancel.length) return NextResponse.json({ ok: true, cancelled: [], failed })

    const now = new Date().toISOString()
    const updates = { status: 'Cancelled', cancelled_at: now, restored_at: null, updated_at: now }
    if (reason) updates.cancelled_reason = reason

    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update(updates)
      .in('id', toCancel)
      .in('status', ['Pending', 'Approved'])
      .eq('branch_id', auth.branchId)
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    // Return reserved stock to the shelf — cancelled orders free their units.
    await releaseOrdersStock(supabase, toCancel)

    await logExhibitionAudit(toCancel, {
      action: 'Cancelled',
      actorType: 'rep',
      actorLabel: `Branch rep · ${auth.claim.branch_code || ''}`,
      note: reason,
    })

    return NextResponse.json({ ok: true, cancelled: toCancel, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
