// app/api/rep/exhibition/vendors/breakdown/route.js
// Per-vendor handover breakdown for the rep's branch. Across the branch's
// APPROVED orders in the active cycle, which vendors still owe goods — i.e.
// lines the vendor has not yet marked delivered. Powers the vendor handover
// panel on the Approved view so reps see at a glance who still needs to hand
// over.
//   GET /api/rep/exhibition/vendors/breakdown
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getRepBranch } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const auth = getRepBranch(req)
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

    const supabase = createClient()
    const branchId = auth.branchId

    // The branch's current season — an active cycle, falling back to the
    // latest one so the panel stays meaningful once a season closes (same
    // resolution as the stats strip).
    let cycleId = null
    let cycleName = ''
    try {
      const { data: active } = await supabase
        .from('exhibition_cycles')
        .select('id, name')
        .eq('branch_id', branchId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .maybeSingle()
      const cycle = active
      if (!cycle) {
        const { data: latest } = await supabase
          .from('exhibition_cycles')
          .select('id, name')
          .eq('branch_id', branchId)
          .order('created_at', { ascending: false })
          .maybeSingle()
        cycleId = Number(latest?.id) || null
        cycleName = latest?.name || ''
      } else {
        cycleId = Number(cycle.id) || null
        cycleName = cycle.name || ''
      }
    } catch {
      // No cycles table — the breakdown just covers the branch's approved orders.
    }

    // Approved orders only: those are the ones waiting on vendor handover.
    let orderQ = supabase.from('exhibition_orders').select('id').eq('branch_id', branchId).eq('status', 'Approved')
    if (cycleId) orderQ = orderQ.eq('cycle_id', cycleId)
    const { data: approved, error: oErr } = await orderQ
    if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 })

    const orderIds = (approved || []).map((o) => o.id)
    const vendors = []
    if (orderIds.length) {
      const { data: lines, error: lErr } = await supabase
        .from('exhibition_order_lines')
        .select('id, order_id, vendor_id, product_name, qty, amount, delivered, vendors:vendor_id(name)')
        .in('order_id', orderIds)
        .order('id')
      if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })

      const by = new Map()
      for (const l of lines || []) {
        const k = l.vendor_id
        const cur = by.get(k) || {
          vendor_id: k,
          vendor_name: l.vendors?.name || '',
          orders: new Set(),
          qty_delivered: 0,
          qty_outstanding: 0,
          amount_delivered: 0,
          amount_outstanding: 0,
        }
        cur.orders.add(Number(l.order_id))
        if (l.delivered) {
          cur.qty_delivered += Number(l.qty || 0)
          cur.amount_delivered += Number(l.amount || 0)
        } else {
          cur.qty_outstanding += Number(l.qty || 0)
          cur.amount_outstanding += Number(l.amount || 0)
        }
        by.set(k, cur)
      }

      for (const v of by.values()) {
        vendors.push({
          vendor_id: v.vendor_id,
          vendor_name: v.vendor_name,
          orders: v.orders.size,
          qty_delivered: v.qty_delivered,
          qty_outstanding: v.qty_outstanding,
          amount_delivered: Math.round(v.amount_delivered),
          amount_outstanding: Math.round(v.amount_outstanding),
        })
      }
      // Vendors still owing goods first, biggest outstanding value on top.
      vendors.sort(
        (a, b) =>
          b.amount_outstanding - a.amount_outstanding ||
          b.qty_outstanding - a.qty_outstanding ||
          a.vendor_name.localeCompare(b.vendor_name)
      )
    }

    // Cycle totals — items and naira still owed across every vendor.
    const totals = vendors.reduce(
      (acc, v) => {
        acc.qty_outstanding += Number(v.qty_outstanding || 0)
        acc.amount_outstanding += Number(v.amount_outstanding || 0)
        acc.qty_delivered += Number(v.qty_delivered || 0)
        acc.amount_delivered += Number(v.amount_delivered || 0)
        return acc
      },
      { qty_outstanding: 0, amount_outstanding: 0, qty_delivered: 0, amount_delivered: 0 }
    )

    return NextResponse.json({
      ok: true,
      cycle: { id: cycleId, name: cycleName },
      totals: {
        qty_outstanding: totals.qty_outstanding,
        amount_outstanding: Math.round(totals.amount_outstanding),
        qty_delivered: totals.qty_delivered,
        amount_delivered: Math.round(totals.amount_delivered),
      },
      vendors,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load vendor breakdown' }, { status: 500 })
  }
}
