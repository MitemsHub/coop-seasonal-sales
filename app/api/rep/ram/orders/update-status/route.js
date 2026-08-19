import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { verify } from '@/lib/signing'
import { logOrderAudit } from '@/lib/orderAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseIds(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (const v of list) {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) out.push(Math.trunc(n))
  }
  return Array.from(new Set(out))
}

export async function POST(req) {
  try {
    const supabase = createClient()
    const token = req.cookies.get('rep_token')?.value
    const claim = token && verify(token)
    if (!claim || claim.role !== 'rep') return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    if (claim.module && claim.module !== 'ram') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

    const rawIds = Array.isArray(claim.ram_delivery_location_ids) ? claim.ram_delivery_location_ids : []
    const allowedLocationIds = (rawIds.length ? rawIds : [claim.ram_delivery_location_id])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (!allowedLocationIds.length) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const status = String(body.status || '').trim()
    if (status !== 'Delivered') return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })

    const ids = parseIds(body.ids)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'No order ids provided' }, { status: 400 })

    const { data, error } = await supabase
      .from('ram_orders')
      .update({ status })
      .in('id', ids)
      .eq('status', 'Approved')
      .in('ram_delivery_location_id', allowedLocationIds)
      .select('id,status')

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Build the no-leak "failed" list (same treatment as the exhibition rep
    // routes). Out-of-scope ids — orders at another delivery location — come
    // back as { id, reason: 'Not in your location' } WITHOUT their status, so
    // a rep can never read another location's order state through this call.
    // In-scope ids that simply weren't eligible (wrong status) get their own
    // status back, which is fine — they belong to this rep.
    const updatedIds = new Set((data || []).map((r) => Number(r.id)))
    const { data: rowRows } = await supabase
      .from('ram_orders')
      .select('id, status, ram_delivery_location_id')
      .in('id', ids)
    const byId = new Map((rowRows || []).map((r) => [Number(r.id), r]))
    const failed = ids
      .filter((id) => !updatedIds.has(id))
      .map((id) => {
        const row = byId.get(id)
        if (!row) return { id, status: '' }
        if (!allowedLocationIds.includes(Number(row.ram_delivery_location_id))) {
          return { id, reason: 'Not in your location' }
        }
        return { id, status: String(row.status || '') }
      })

    // Audit (food pattern) — record the delivery, tagged with the rep vendor.
    await logOrderAudit(
      supabase,
      (data || []).map((r) => ({
        actor: `rep:${claim.ram_vendor_code || claim.ram_delivery_location_id || 'ram'}`,
        action: 'deliver',
        order_id: String(r.id),
        detail: { status },
      })),
      'ram'
    )

    const updated = (data || []).map((r) => ({ id: r.id, status: r.status }))
    return NextResponse.json({ ok: true, updated, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}

