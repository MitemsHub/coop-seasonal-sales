// app/api/exhibition/availability/route.js
//   GET /api/exhibition/availability
// Lightweight "is the exhibition open?" probe for the navbar dot and the
// module card on the member dashboard. Those two only need a boolean and the
// season's name/end date, but both used to call /api/exhibition/catalog, which
// also builds the full vendor + product list (and its negotiated-price query).
// This route answers from the cycles table alone.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return (
    msg.includes(String(table || '').toLowerCase()) &&
    (msg.includes('does not exist') || msg.includes('could not find the table'))
  )
}

export async function GET() {
  try {
    const supabase = createClient()

    // Same rule the catalog applies: "live" means status 'active' AND inside
    // its date window. The latest cycle (any status) is returned so the UI can
    // still show a draft/closed season's name.
    const { data: activeRows, error: activeErr } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, starts_at, ends_at, loan_interest_rate_pct')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(2)

    if (activeErr) {
      if (isMissingTable(activeErr, 'exhibition')) return NextResponse.json({ ok: true, open: false, cycle: null })
      return NextResponse.json({ ok: false, error: activeErr.message }, { status: 500 })
    }

    // `.limit(1)` before `.maybeSingle()` is required: maybeSingle() errors when
    // more than one row matches, which would 500 the probe during a moment when
    // two seasons overlap — exactly when the "is it open?" answer matters.
    const { data: latest, error: latestErr } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, starts_at, ends_at, loan_interest_rate_pct')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestErr && !isMissingTable(latestErr, 'exhibition')) {
      return NextResponse.json({ ok: false, error: latestErr.message }, { status: 500 })
    }

    const now = Date.now()
    const live = (activeRows || []).find((c) => {
      if (c.starts_at && new Date(c.starts_at).getTime() > now) return false
      if (c.ends_at && new Date(c.ends_at).getTime() <= now) return false
      return true
    })

    const cycle = live || latest
    if (!cycle) return NextResponse.json({ ok: true, open: false, cycle: null })

    return NextResponse.json({
      ok: true,
      open: !!live,
      cycle: {
        id: Number(cycle.id),
        name: cycle.name || '',
        code: cycle.code || '',
        status: cycle.status || 'draft',
        starts_at: cycle.starts_at || null,
        ends_at: cycle.ends_at || null,
        loan_interest_rate_pct: Math.max(0, Number(cycle.loan_interest_rate_pct ?? 0)),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load availability' }, { status: 500 })
  }
}
