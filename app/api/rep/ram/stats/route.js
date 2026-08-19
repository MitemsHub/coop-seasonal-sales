// app/api/rep/ram/stats/route.js
// Rep-scoped ram stats for the rep's own delivery locations — powers the
// summary strip + charts on the rep dashboard's Ram view.
//   GET /api/rep/ram/stats
// Returns per-status order counts + totals (Pending/Approved/Delivered/
// Cancelled) plus today's new orders, all filtered to the rep's
// ram_delivery_location_ids (the locations from their rep_token claim).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { verify } from '@/lib/signing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['Pending', 'Approved', 'Delivered', 'Cancelled']

export async function GET(req) {
  try {
    const supabase = createClient()
    const token = req.cookies.get('rep_token')?.value
    const claim = token && verify(token)
    if (!claim || claim.role !== 'rep') return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    if (claim.module && claim.module !== 'ram') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

    const rawIds = Array.isArray(claim.ram_delivery_location_ids) ? claim.ram_delivery_location_ids : []
    const ids = (rawIds.length ? rawIds : [claim.ram_delivery_location_id])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })

    // The active ram season — falls back to the latest one so "delivered this
    // cycle" stays meaningful once a season closes. Missing table → zeros.
    let cycleId = null
    let cycleName = ''
    let cycleCode = ''
    try {
      const { data: active } = await supabase
        .from('ram_cycles')
        .select('id, name, code')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .maybeSingle()
      if (!active) {
        const { data: latest } = await supabase
          .from('ram_cycles')
          .select('id, name, code')
          .order('created_at', { ascending: false })
          .maybeSingle()
        cycleId = Number(latest?.id) || null
        cycleName = latest?.name || ''
        cycleCode = latest?.code || ''
      } else {
        cycleId = Number(active.id) || null
        cycleName = active.name || ''
        cycleCode = active.code || ''
      }
    } catch {
      // No ram_cycles table — cycle-scoped figures read 0.
    }

    const { data, error } = await supabase
      .from('ram_orders')
      .select('status, total_amount, created_at, ram_cycle_id')
      .in('ram_delivery_location_id', ids)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

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
        if (key === 'Delivered' && cycleId && Number(row.ram_cycle_id) === cycleId) {
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
    }

    for (const s of STATUSES) statuses[s].total = Math.round(statuses[s].total)

    return NextResponse.json({
      ok: true,
      cycle: { id: cycleId, name: cycleName, code: cycleCode },
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
