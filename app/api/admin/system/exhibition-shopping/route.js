// app/api/admin/system/exhibition-shopping/route.js
// Admin endpoint to read exhibition availability — now derived solely from
// cycle status (no master toggle). Kept for backward compatibility with any
// admin UI that still fetches it.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_cycles')
      .select('id')
      .eq('status', 'active')
      .limit(100)
    if (error) {
      const msg = `${error.message || ''} ${error.details || ''}`.toLowerCase()
      if (msg.includes('does not exist') || msg.includes('could not find the table')) {
        return NextResponse.json({ ok: true, open: false, activeCount: 0 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    const activeCount = (data || []).length
    return NextResponse.json({ ok: true, open: activeCount > 0, activeCount })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to read exhibition status' }, { status: 500 })
  }
}
