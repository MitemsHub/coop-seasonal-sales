// app/api/exhibition/delivery-branches/route.js
// Member-facing list of delivery branches taking part in the OPEN season.
// The exhibition season is org-wide (one cycle for every branch, like Food and
// RAM), so this list comes from the branches that actually have active products
// in the live cycle — not from one cycle row per branch.
//   GET /api/exhibition/delivery-branches
// Returns [{ code, name }].
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

export async function GET() {
  try {
    const supabase = createClient()

    const { data: cycles, error } = await supabase
      .from('exhibition_cycles')
      .select('id, starts_at, ends_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(2)
    if (error) {
      if (isMissingTable(error, 'exhibition')) {
        // Module not set up yet — treat as no open delivery locations.
        return NextResponse.json({ ok: true, branches: [] })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // Auto-close: a cycle whose window has passed is not live.
    const now = Date.now()
    const cycle = (cycles || []).find((c) => {
      if (c.starts_at && new Date(c.starts_at).getTime() > now) return false
      if (c.ends_at && new Date(c.ends_at).getTime() <= now) return false
      return true
    })
    if (!cycle) return NextResponse.json({ ok: true, branches: [] })

    // A branch takes part when it has at least one active product this season.
    const { data: products, error: pErr } = await supabase
      .from('exhibition_products')
      .select('branch_id')
      .eq('cycle_id', cycle.id)
      .eq('status', 'active')
    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })

    const branchIds = [...new Set((products || []).map((p) => Number(p.branch_id)).filter((n) => Number.isFinite(n) && n > 0))]
    if (!branchIds.length) return NextResponse.json({ ok: true, branches: [] })

    const { data: branches, error: bErr } = await supabase
      .from('branches')
      .select('id, code, name')
      .in('id', branchIds)
      .order('name')
    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      branches: (branches || []).map((b) => ({ code: b.code, name: b.name || b.code })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load delivery branches' }, { status: 500 })
  }
}
