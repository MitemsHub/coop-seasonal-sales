// app/api/exhibition/events/route.js
// Fire-and-forget product insights.
//   POST { member_id, type: 'view'|'add'|'search', product_id?, vendor_id?,
//          query?, results? }
// Views and adds power the vendor's insights page; searches with results = 0
// show what the market asked for and did not find.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateMemberId } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BATCH = 60

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const memberRes = validateMemberId(String(body.member_id || ''))
    const memberId = memberRes.isValid ? memberRes.sanitized.toUpperCase() : ''

    const type = String(body.type || '').toLowerCase()
    if (!['view', 'add', 'search'].includes(type)) {
      return NextResponse.json({ ok: false, error: 'Invalid event type' }, { status: 400 })
    }

    const supabase = createClient()
    const rows = []

    if (type === 'search') {
      const query = String(body.query || '').trim().slice(0, 80)
      if (!query) return NextResponse.json({ ok: true, recorded: 0 })
      rows.push({
        member_id: memberId,
        event_type: 'search',
        query,
        results: Math.max(0, Math.trunc(Number(body.results) || 0)),
      })
    } else {
      const ids = (Array.isArray(body.product_ids) ? body.product_ids : [body.product_id])
        .map((v) => Math.trunc(Number(v)))
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, MAX_BATCH)
      if (!ids.length) return NextResponse.json({ ok: true, recorded: 0 })

      const { data: products } = await supabase
        .from('exhibition_products')
        .select('id, vendor_id, cycle_id')
        .in('id', ids)
      for (const p of products || []) {
        rows.push({
          member_id: memberId,
          event_type: type,
          product_id: Number(p.id),
          vendor_id: Number(p.vendor_id),
          cycle_id: p.cycle_id ? Number(p.cycle_id) : null,
        })
      }
    }

    if (!rows.length) return NextResponse.json({ ok: true, recorded: 0 })
    // Insights must never break shopping: failures are swallowed.
    const { error } = await supabase.from('exhibition_events').insert(rows)
    if (error) return NextResponse.json({ ok: true, recorded: 0 })
    return NextResponse.json({ ok: true, recorded: rows.length })
  } catch {
    return NextResponse.json({ ok: true, recorded: 0 })
  }
}
