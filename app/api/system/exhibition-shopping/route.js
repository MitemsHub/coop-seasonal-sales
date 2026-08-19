// app/api/system/exhibition-shopping/route.js
// Public endpoint to read whether the Coop Exhibition is live — mirrors
// /api/system/shopping (food) and /api/system/ram-shopping (ram), but derives
// availability from the exhibition cycles: the exhibition is open while any
// branch has a cycle in the 'active' status. When live, also exposes the
// active cycle's name + closing date so UI can show reps the timeline.
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
      .limit(1)
    if (error) {
      const msg = `${error.message || ''} ${error.details || ''}`.toLowerCase()
      // Exhibition module not set up yet — report closed rather than erroring.
      if (msg.includes('does not exist') || msg.includes('could not find the table')) {
        return NextResponse.json({ ok: true, open: false })
      }
      return NextResponse.json({ ok: false, error: error.message || 'Failed to read exhibition status' }, { status: 500 })
    }
    const active = (data || [])[0] || null

    // Master Shopping Control toggle (admin) — unset defaults to open so
    // availability still follows the active seasons; when the admin closes
    // it, the exhibition is closed regardless of cycles.
    let settingRow = null
    try {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'exhibition_shopping_open')
        .maybeSingle()
      settingRow = data
    } catch {
      // Missing table or read failure — treat as unset (default open)
      settingRow = null
    }
    const toggleOpen = settingRow?.value !== 'false'

    return NextResponse.json({
      ok: true,
      open: toggleOpen && !!active,
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
