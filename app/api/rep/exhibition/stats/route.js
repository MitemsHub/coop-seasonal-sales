// app/api/rep/exhibition/stats/route.js
// Rep-scoped exhibition stats for the rep's own branch — powers the summary
// strip on the rep exhibition order views and the rep dashboard.
//   GET /api/rep/exhibition/stats
// Returns per-status order counts + totals (Pending/Approved/Delivered/
// Cancelled) plus today's new orders, all filtered to the rep's branch_id,
// and a per-cycle breakdown so reps can compare activity across seasons.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getRepBranch } from '../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['Pending', 'Approved', 'Delivered', 'Cancelled']

export async function GET(req) {
  try {
    const auth = getRepBranch(req)
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_orders')
      .select('status, total_amount, created_at, cycle_id')
      .eq('branch_id', auth.branchId)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // ── Cycles: one row per exhibition season, newest first ───────────
    // The active season drives "delivered this cycle"; the full list feeds
    // the per-cycle comparison so reps can see how seasons stack up.
    const cycles = []
    let activeCycle = null
    let latestCycle = null
    try {
      const { data: cycleRows } = await supabase
        .from('exhibition_cycles')
        .select('id, name, code, status, starts_at, ends_at')
        .eq('branch_id', auth.branchId)
        .order('created_at', { ascending: false })

      for (const c of cycleRows || []) {
        const entry = {
          id: Number(c.id),
          name: c.name || '',
          code: c.code || '',
          status: c.status || 'draft',
          startsAt: c.starts_at || null,
          endsAt: c.ends_at || null,
          orders: 0,
          total: 0,
          statuses: {},
        }
        cycles.push(entry)
        if (c.status === 'active' && !activeCycle) activeCycle = entry
        if (!latestCycle) latestCycle = entry
      }
    } catch {
      // No cycles table — per-cycle breakdown just comes back empty.
    }

    // The season the strip reports against: active first, latest as fallback.
    const current = activeCycle || latestCycle
    const cycleId = current?.id ?? null
    const cycleName = current?.name ?? ''
    const cycleCode = current?.code ?? ''

    const statuses = {}
    for (const s of STATUSES) statuses[s] = { count: 0, total: 0 }

    const todayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
    let todayCount = 0
    let todayTotal = 0
    let todayPendingCount = 0
    let todayPendingTotal = 0
    let deliveredCycleCount = 0
    let deliveredCycleTotal = 0

    for (const row of data || []) {
      const key = STATUSES.includes(String(row.status)) ? row.status : null
      if (key) {
        statuses[key].count += 1
        statuses[key].total += Number(row.total_amount || 0)
        if (key === 'Delivered' && cycleId && Number(row.cycle_id) === cycleId) {
          deliveredCycleCount += 1
          deliveredCycleTotal += Number(row.total_amount || 0)
        }
      }
      if (String(row.created_at || '') >= todayStart) {
        todayCount += 1
        todayTotal += Number(row.total_amount || 0)
        if (key === 'Pending') {
          todayPendingCount += 1
          todayPendingTotal += Number(row.total_amount || 0)
        }
      }

      // Per-cycle accumulation
      const rowCycleId = Number(row.cycle_id)
      const cycle = cycles.find((c) => c.id === rowCycleId)
      if (cycle) {
        cycle.orders += 1
        cycle.total += Number(row.total_amount || 0)
        if (key) {
          cycle.statuses[key] = cycle.statuses[key] || { count: 0, total: 0 }
          cycle.statuses[key].count += 1
          cycle.statuses[key].total += Number(row.total_amount || 0)
        }
      }
    }

    for (const s of STATUSES) statuses[s].total = Math.round(statuses[s].total)
    for (const c of cycles) {
      c.total = Math.round(c.total)
      for (const s of STATUSES) {
        const v = c.statuses[s] || { count: 0, total: 0 }
        c.statuses[s] = { count: v.count, total: Math.round(v.total) }
      }
    }

    return NextResponse.json({
      ok: true,
      branch_id: auth.branchId,
      cycle: { id: cycleId, name: cycleName, code: cycleCode },
      cycles,
      statuses,
      today: { count: todayCount, total: Math.round(todayTotal) },
      todayPending: { count: todayPendingCount, total: Math.round(todayPendingTotal) },
      deliveredCycle: { count: deliveredCycleCount, total: Math.round(deliveredCycleTotal) },
      total: (data || []).length,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load stats' }, { status: 500 })
  }
}
