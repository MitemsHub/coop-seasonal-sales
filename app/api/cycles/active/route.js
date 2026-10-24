// GET /api/cycles/active — the active food cycle + active RAM cycle.
// Serves the my-coop dashboard (which used to read `cycles` and `ram_cycles`
// with the anon browser client). Cycle metadata is non-personal catalog data.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CYCLE_COLS = 'id, code, name, ends_at'

export async function GET() {
  try {
    const supabase = createClient()

    const [food, ram] = await Promise.all([
      supabase.from('cycles').select(CYCLE_COLS).eq('is_active', true).maybeSingle(),
      supabase.from('ram_cycles').select(CYCLE_COLS).eq('is_active', true).maybeSingle(),
    ])

    return NextResponse.json({
      ok: true,
      food: food?.data || null,
      ram: ram?.data || null,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load cycles' }, { status: 500 })
  }
}
