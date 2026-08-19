// app/api/system/pending-counts/route.js
// Public endpoint with the global pending-order totals per module — powers the
// "N pending" chips on pre-login surfaces like the rep access cards, mirroring
// the admin switcher's pending chips. Missing tables (module not set up)
// simply read 0 rather than erroring, same tolerance as the shopping flags.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()
    const [food, ram, exhibition] = await Promise.allSettled([
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
      supabase.from('ram_orders').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
      supabase.from('exhibition_orders').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
    ])
    const read = (p) =>
      p.status === 'fulfilled' && !p.value.error ? Number(p.value.count || 0) : 0
    return NextResponse.json({
      ok: true,
      counts: {
        food: read(food),
        ram: read(ram),
        exhibition: read(exhibition),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to read pending counts' }, { status: 500 })
  }
}
