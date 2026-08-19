// app/api/admin/exhibition/summary/route.js
// Dashboard summary for the Coop Exhibition module.
//   GET /api/admin/exhibition/summary
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const supabase = createClient()

    const [cyclesRes, vendorsRes, productsRes, ordersRes, payRes] = await Promise.all([
      supabase.from('exhibition_cycles').select('id, name, code, status, vendor_deduction_rate_pct, created_at, starts_at, ends_at, branch_id, branches:branch_id(name)'),
      supabase.from('exhibition_vendors').select('id'),
      supabase.from('exhibition_products').select('id, status'),
      supabase.from('exhibition_orders').select('id, order_id, status, total_amount, member_id, member_name_snapshot, payment_option, created_at, cycle_id'),
      supabase.from('exhibition_vendor_payment_status').select('id, vendor_id, paid, amount'),
    ])

    if (cyclesRes.error && isMissingTable(cyclesRes.error, 'exhibition')) {
      return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet. Run migrations/add-coop-exhibition-module.sql in Supabase.' }, { status: 500 })
    }
    const cycles = cyclesRes.error ? [] : cyclesRes.data || []
    const vendors = vendorsRes.error ? [] : vendorsRes.data || []
    const products = productsRes.error ? [] : productsRes.data || []
    const orders = ordersRes.error ? [] : ordersRes.data || []
    const payments = payRes.error ? [] : payRes.data || []

    const activeCycles = cycles.filter((c) => c.status === 'active')
    // The most recently created active season — drives the "closes on"
    // timeline shown next to the dashboard's Exhibition switcher pill.
    const activeCycle = [...activeCycles].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    )[0] || null
    const activeCycleIds = new Set(activeCycles.map((c) => Number(c.id)))
    const activeOrders = orders.filter((o) => activeCycleIds.has(Number(o.cycle_id)))

    // Order figures report the ACTIVE period (the current season across the
    // live branches), mirroring the rep-side active-cycle scoping. The
    // per-cycle comparison below keeps the historical view for payouts.
    const byStatus = { Pending: 0, Approved: 0, Delivered: 0, Cancelled: 0 }
    let amount = 0
    // Payment-split amounts for the dashboard's value cards (active cycle,
    // non-cancelled orders) — loan / savings / cash, mirroring the food module.
    const amounts = { total: 0, loans: 0, savings: 0, cash: 0 }
    for (const o of activeOrders) {
      if (byStatus[o.status] !== undefined) byStatus[o.status]++
      if (o.status === 'Cancelled') continue
      const total = Number(o.total_amount || 0)
      amount += total
      const key = String(o.payment_option || '')
      if (key === 'Loan') amounts.loans += total
      else if (key === 'Savings') amounts.savings += total
      else if (key === 'Cash') amounts.cash += total
    }
    amounts.total = amount

    // Per-vendor order value (active cycle, non-cancelled) for the top/bottom
    // vendor performance charts — mirroring the food dashboard's branch charts.
    let vendorsByValue = []
    if (activeCycleIds.size) {
      const [linesRes, vendorsRes] = await Promise.all([
        supabase
          .from('exhibition_order_lines')
          .select('vendor_id, amount, orders:order_id(cycle_id, status)')
          .in('orders.cycle_id', Array.from(activeCycleIds))
          .neq('orders.status', 'Cancelled'),
        supabase.from('exhibition_vendors').select('id, name'),
      ])
      const vendorName = new Map((vendorsRes?.data || []).map((v) => [Number(v.id), v.name || '']))
      const acc = new Map()
      for (const l of linesRes?.data || []) {
        const cid = Number(l.orders?.cycle_id)
        if (!activeCycleIds.has(cid)) continue
        const vid = Number(l.vendor_id)
        acc.set(vid, (acc.get(vid) || 0) + Number(l.amount || 0))
      }
      vendorsByValue = Array.from(acc.entries())
        .map(([vendor_id, value]) => ({ vendor_id, vendor_name: vendorName.get(vendor_id) || 'Vendor', value }))
        .sort((a, b) => b.value - a.value)
    }

    // ── Per-cycle payout figures for the dashboard chart ──────────────
    // Gross = non-cancelled line totals, deduction at the cycle's vendor
    // rate, net = what vendors are owed. Paid is vendor-aware: a vendor
    // counts as paid only when ALL of their payment rows for the cycle are
    // paid (the same rule the payouts page uses), so a partially-paid
    // multi-order vendor never leaks a partial amount into the totals.
    const recentCycles = [...cycles]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 10)
    const recentCycleIds = recentCycles.map((c) => Number(c.id))
    const deductionRate = new Map(
      recentCycles.map((c) => [Number(c.id), Math.max(0, Number(c.vendor_deduction_rate_pct ?? 0)) / 100])
    )
    const payAcc = new Map(recentCycleIds.map((id) => [id, { gross: 0, paid: 0 }]))
    if (recentCycleIds.length) {
      const [linesRes, payAllRes] = await Promise.all([
        supabase
          .from('exhibition_order_lines')
          .select('vendor_id, order_id, amount, orders:order_id(cycle_id, status)')
          .in('orders.cycle_id', recentCycleIds)
          .neq('orders.status', 'Cancelled'),
        supabase
          .from('exhibition_vendor_payment_status')
          .select('cycle_id, vendor_id, amount, paid')
          .in('cycle_id', recentCycleIds),
      ])
      // Gross per (cycle, vendor) and paid-state per (cycle, vendor).
      const grossByVendor = new Map()
      if (!linesRes.error) {
        for (const l of linesRes.data || []) {
          const cid = Number(l.orders?.cycle_id)
          const cur = payAcc.get(cid)
          if (cur) cur.gross += Number(l.amount || 0)
          const key = `${cid}|${Number(l.vendor_id)}`
          grossByVendor.set(key, (grossByVendor.get(key) || 0) + Number(l.amount || 0))
        }
      }
      const paidStateByVendor = new Map()
      if (!payAllRes.error) {
        for (const p of payAllRes.data || []) {
          const key = `${Number(p.cycle_id)}|${Number(p.vendor_id)}`
          const cur = paidStateByVendor.get(key) || { allPaid: true, count: 0 }
          cur.count += 1
          if (!p.paid) cur.allPaid = false
          paidStateByVendor.set(key, cur)
        }
      }
      for (const cid of recentCycleIds) {
        const rate = deductionRate.get(cid) || 0
        let paid = 0
        for (const [key, info] of paidStateByVendor) {
          if (!info.allPaid || info.count === 0 || !key.startsWith(`${cid}|`)) continue
          const vid = key.slice(String(cid).length + 1)
          const gross = grossByVendor.get(`${cid}|${vid}`) || 0
          paid += Math.max(0, Math.round(gross * (1 - rate)))
        }
        payAcc.set(cid, { gross: payAcc.get(cid)?.gross || 0, paid })
      }
    }
    const cycle_payouts = recentCycles.map((c) => {
      const acc = payAcc.get(Number(c.id)) || { gross: 0, paid: 0 }
      const rate = deductionRate.get(Number(c.id)) || 0
      const gross = Math.round(acc.gross)
      const deduction = Math.round(gross * rate)
      const net = Math.max(0, gross - deduction)
      const paid = Math.min(net, Math.round(acc.paid))
      return {
        cycle_id: c.id,
        name: c.name || '',
        code: c.code || '',
        status: c.status || '',
        gross,
        deduction,
        net,
        paid,
        balance: Math.max(0, net - paid),
      }
    })

    return NextResponse.json({
      ok: true,
      summary: {
        cycles: cycles.length,
        active_cycles: activeCycles.length,
        active_cycle: activeCycle
          ? {
              id: Number(activeCycle.id),
              name: activeCycle.name || '',
              code: activeCycle.code || '',
              starts_at: activeCycle.starts_at || null,
              ends_at: activeCycle.ends_at || null,
            }
          : null,
        branches: new Set(cycles.map((c) => c.branch_id)).size,
        vendors: vendors.length,
        products: products.length,
        active_products: products.filter((p) => p.status === 'active').length,
        orders: activeOrders.length,
        byStatus,
        amount,
        amounts,
        vendors_by_value: vendorsByValue,
        active_orders: activeOrders.length,
        active_amount: activeOrders.filter((o) => o.status !== 'Cancelled').reduce((s, o) => s + Number(o.total_amount || 0), 0),
        // Vendor-aware: only vendors whose payment rows are ALL paid count,
        // so a partially-paid multi-order vendor is excluded entirely. The
        // figure is the sum of those vendors' paid row amounts (checkout-time
        // gross snapshots); the authoritative net paid per season lives in
        // cycle_payouts, which applies the deduction rate.
        paid_to_vendors: (() => {
          const state = new Map()
          for (const p of payments) {
            const vid = Number(p.vendor_id)
            const cur = state.get(vid) || { allPaid: true, count: 0 }
            cur.count += 1
            if (!p.paid) cur.allPaid = false
            state.set(vid, cur)
          }
          const fullyPaid = new Set([...state].filter(([, s]) => s.allPaid && s.count > 0).map(([vid]) => vid))
          return payments.filter((p) => fullyPaid.has(Number(p.vendor_id))).reduce((s, p) => s + Number(p.amount || 0), 0)
        })(),
        cycle_payouts,
        recent_orders: [...activeOrders]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 8)
          .map((o) => ({ id: o.id, status: o.status, total_amount: o.total_amount, member_name_snapshot: o.member_name_snapshot || '', member_id: o.member_id, order_id: o.order_id, payment_option: o.payment_option, created_at: o.created_at })),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load summary' }, { status: 500 })
  }
}
