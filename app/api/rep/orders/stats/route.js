// app/api/rep/orders/stats/route.js
// Rep-scoped food order stats for the rep's own delivery branch — powers the
// summary strip on the rep posted (pending) view.
//   GET /api/rep/orders/stats
// Returns today's pending count + total (the queue the rep clears), this
// cycle's posted count + total, and delivered count + total for the active
// food cycle, plus branch-wide per-status counts so the view mirrors the
// exhibition strip's at-a-glance cards.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { verify } from '@/lib/signing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const token = req.cookies.get('rep_token')?.value
    const claim = token && verify(token)
    if (!claim || claim.role !== 'rep') return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    if (claim.module && claim.module !== 'food') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    const branchId = Math.trunc(Number(claim.branch_id))
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

    const supabase = createClient()

    // The active food cycle (orders carry cycle_id). If the column or the
    // table is missing, cycle-scoped figures just read 0.
    let cycleId = null
    try {
      const { data: active } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
      cycleId = Number(active?.id) || null
    } catch {
      // No cycles table — cycle-scoped figures read 0.
    }

    const { data, error } = await supabase
      .from('orders')
      .select('status, total_amount, created_at, cycle_id')
      .eq('delivery_branch_id', branchId)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Branch-wide per-status cards, mirroring the exhibition strip.
    const STATUSES = ['Pending', 'Posted', 'Delivered', 'Cancelled']
    const statuses = {}
    for (const s of STATUSES) statuses[s] = { count: 0, total: 0 }

    const todayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
    let todayPendingCount = 0
    let todayPendingTotal = 0
    let postedCycleCount = 0
    let postedCycleTotal = 0
    let deliveredCycleCount = 0
    let deliveredCycleTotal = 0

    for (const row of data || []) {
      const status = String(row.status || '')
      const amt = Number(row.total_amount || 0)
      const isToday = String(row.created_at || '') >= todayStart
      const inCycle = cycleId != null && Number(row.cycle_id) === cycleId

      const key = STATUSES.includes(status) ? status : null
      if (key) {
        statuses[key].count += 1
        statuses[key].total += amt
      }
      if (isToday && status === 'Pending') {
        todayPendingCount += 1
        todayPendingTotal += amt
      }
      if (inCycle && status === 'Posted') {
        postedCycleCount += 1
        postedCycleTotal += amt
      }
      if (inCycle && status === 'Delivered') {
        deliveredCycleCount += 1
        deliveredCycleTotal += amt
      }
    }

    for (const s of STATUSES) statuses[s].total = Math.round(statuses[s].total)

    return NextResponse.json({
      ok: true,
      branch_id: branchId,
      statuses,
      todayPending: { count: todayPendingCount, total: Math.round(todayPendingTotal) },
      postedCycle: { count: postedCycleCount, total: Math.round(postedCycleTotal) },
      deliveredCycle: { count: deliveredCycleCount, total: Math.round(deliveredCycleTotal) },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load stats' }, { status: 500 })
  }
}
