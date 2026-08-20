// app/api/system/exhibition-shopping/route.js
// Public endpoint to read whether the Coop Exhibition is live — mirrors
// /api/system/shopping (food) and /api/system/ram-shopping (ram). The
// exhibition is open while any branch has a cycle in the 'active' status.
// Also returns the count of active cycles so the admin sidebar can show it.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, ends_at')
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
    const active = (data || [])[0] || null
    const activeCount = (data || []).length

    return NextResponse.json({
      ok: true,
      open: activeCount > 0,
      activeCount,
      cycle: active
        ? {
            id: Number(active.id),
            name: active.name || '',
            code: active.code || '',
            ends_at: active.ends_at || null,
          }
        : null,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to read exhibition status' }, { status: 500 })
  }
}
