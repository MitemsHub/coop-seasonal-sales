// app/api/cycle/tag/route.js
// The "which cycle are we on" source for the tag in every top bar.
//   GET /api/cycle/tag
// Returns the current cycle per module so staff and members can never be in
// doubt about which season a page is acting on:
//   food       — the active cycle, else the newest one this co-op has orders in
//                (that is the campaign the back office is still working), else
//                simply the newest cycle.
//   ram        — the active ram cycle, else the newest.
//   exhibition — the active exhibition cycle, else the newest.
// Only names, codes and dates are exposed — nothing operational.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function inWindow(row, now) {
  const start = row?.starts_at ? new Date(row.starts_at).getTime() : null
  const end = row?.ends_at ? new Date(row.ends_at).getTime() : null
  if (start && start > now) return false
  if (end && end <= now) return false
  return true
}

async function newestCycleWithOrders(supabase) {
  const { data } = await supabase
    .from('orders')
    .select('cycle_id')
    .not('cycle_id', 'is', null)
    .order('order_id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.cycle_id ? Number(data.cycle_id) : null
}

const shape = (row, open) =>
  row
    ? {
        id: Number(row.id),
        name: row.name || row.code || '',
        code: row.code || '',
        is_active: !!row.is_active,
        open,
        starts_at: row.starts_at || null,
        ends_at: row.ends_at || null,
      }
    : null

export async function GET() {
  try {
    const supabase = createClient()
    const now = Date.now()

    const FOOD_COLS = 'id, name, code, is_active, starts_at, ends_at'
    const [{ data: activeFood }, { data: latestFood }] = await Promise.all([
      supabase.from('cycles').select(FOOD_COLS).eq('is_active', true).maybeSingle(),
      supabase.from('cycles').select(FOOD_COLS).order('id', { ascending: false }).limit(1).maybeSingle(),
    ])

    let food = activeFood || null
    if (!food) {
      // Matches every staff screen: work the newest campaign that has orders.
      const id = await newestCycleWithOrders(supabase)
      if (id) {
        const { data } = await supabase.from('cycles').select(FOOD_COLS).eq('id', id).maybeSingle()
        food = data || latestFood
      } else {
        food = latestFood
      }
    }

    const [{ data: activeRam }, { data: latestRam }] = await Promise.all([
      supabase
        .from('ram_cycles')
        .select('id, name, code, is_active, starts_at, ends_at')
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('ram_cycles')
        .select('id, name, code, is_active, starts_at, ends_at')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const ram = activeRam || latestRam

    const [{ data: activeExh }, { data: latestExh }] = await Promise.all([
      supabase
        .from('exhibition_cycles')
        .select('id, name, code, status, starts_at, ends_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('exhibition_cycles')
        .select('id, name, code, status, starts_at, ends_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const exhibition = activeExh || latestExh

    return NextResponse.json({
      ok: true,
      cycles: {
        food: shape(food, !!(food && food.is_active && inWindow(food, now))),
        ram: shape(ram, !!(ram && ram.is_active && inWindow(ram, now))),
        exhibition: shape(
          exhibition,
          !!(exhibition && exhibition.status === 'active' && inWindow(exhibition, now))
        ),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load cycles' }, { status: 500 })
  }
}
