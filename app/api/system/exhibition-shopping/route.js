// app/api/system/exhibition-shopping/route.js
// Public endpoint to read whether the Coop Exhibition is live.
// The exhibition is open while any branch has a non-expired cycle in the
// 'active' status.  A cycle is considered expired when its ends_at has
// passed (auto-close) — even if the admin hasn't clicked 'Close'.
// Also returns the count of live cycles so the admin sidebar can show it.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Filter out cycles whose date window has closed or hasn't opened yet. */
function isCycleLive(cycle) {
  if (!cycle) return false
  const now = Date.now()
  if (cycle.starts_at && new Date(cycle.starts_at).getTime() > now) return false
  if (cycle.ends_at && new Date(cycle.ends_at).getTime() <= now) return false
  return true
}

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, starts_at, ends_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    if (error) {
      const msg = `${error.message || ''} ${error.details || ''}`.toLowerCase()
      // Exhibition module not set up yet — report closed rather than erroring.
      if (msg.includes('does not exist') || msg.includes('could not find the table')) {
        return NextResponse.json({ ok: true, open: false, activeCount: 0 })
      }
      return NextResponse.json({ ok: false, error: error.message || 'Failed to read exhibition status' }, { status: 500 })
    }

    // Only count cycles whose date window is currently open (auto-close).
    const liveCycles = (data || []).filter(isCycleLive)
    const first = liveCycles[0] || null

    return NextResponse.json({
      ok: true,
      open: liveCycles.length > 0,
      activeCount: liveCycles.length,
      cycle: first
        ? {
            id: Number(first.id),
            name: first.name || '',
            code: first.code || '',
            starts_at: first.starts_at || null,
            ends_at: first.ends_at || null,
          }
        : null,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to read exhibition status' }, { status: 500 })
  }
}
