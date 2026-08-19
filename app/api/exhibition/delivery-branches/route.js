// app/api/exhibition/delivery-branches/route.js
// Member-facing list of delivery branches that have an OPEN exhibition cycle.
// The exhibition cart shows only these — members pick up from a branch whose
// market is actually open this season, not from a list of every branch.
//   GET /api/exhibition/delivery-branches
// Returns [{ code, name }] — one entry per branch with an active cycle.
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
    const { data, error } = await supabase
      .from('exhibition_cycles')
      .select('id, name, status, branches:branch_id(code, name)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    if (error) {
      if (isMissingTable(error, 'exhibition')) {
        // Module not set up yet — treat as no open delivery locations.
        return NextResponse.json({ ok: true, branches: [] })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // One entry per branch (a branch has at most one active cycle).
    const seen = new Set()
    const branches = []
    for (const c of data || []) {
      const b = c.branches
      if (!b?.code || seen.has(b.code)) continue
      seen.add(b.code)
      branches.push({ code: b.code, name: b.name || b.code })
    }
    return NextResponse.json({ ok: true, branches })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load delivery branches' }, { status: 500 })
  }
}
