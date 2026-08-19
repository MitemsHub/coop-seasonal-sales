// app/api/admin/exhibition/payouts/route.js
// Vendor payouts for an exhibition cycle. The co-op pays vendors after the
// exhibition; amounts are the per-vendor line totals across DELIVERED lines
// (goods handed over) minus the cycle's vendor deduction rate. Pending and
// Approved lines are not owed yet.
//   GET  — per-vendor summary: owed, paid, balance, orders
//   POST — mark a vendor paid (or unmark) for the cycle { vendor_id, cycle_id, paid }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return NextResponse.json({ ok: false, error: 'cycle_id is required' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: cycle } = await supabase
      .from('exhibition_cycles')
      .select('id, name, vendor_deduction_rate_pct')
      .eq('id', cycleId)
      .maybeSingle()
    if (!cycle) return NextResponse.json({ ok: false, error: 'Cycle not found' }, { status: 404 })
    const deductionRate = Math.max(0, Number(cycle.vendor_deduction_rate_pct ?? 0)) / 100

    const [vendorsRes, linesRes, payRes] = await Promise.all([
      supabase.from('exhibition_vendors').select('id, name, code, phone, address').eq('cycle_id', cycleId).order('name'),
      supabase
        .from('exhibition_order_lines')
        .select('vendor_id, amount, orders:order_id!inner(status)')
        .eq('orders.cycle_id', cycleId)
        .neq('orders.status', 'Cancelled')
        .eq('delivered', true),
      // One payment-status row per (order, vendor) — a vendor is "paid" only
      // when ALL of their rows for the cycle are paid. Cancelled orders' rows
      // are ignored entirely.
      supabase
        .from('exhibition_vendor_payment_status')
        .select('vendor_id, amount, paid, paid_at, orders:order_id!inner(status)')
        .eq('cycle_id', cycleId)
        .not('orders.status', 'eq', 'Cancelled'),
    ])
    if (linesRes.error) return NextResponse.json({ ok: false, error: linesRes.error.message }, { status: 500 })

    // Aggregate across the vendor's per-order rows: paid = all rows paid,
    // paid_at = latest timestamp. The amount actually paid out is the net
    // figure (gross minus deduction), so that is what paid_amount reports —
    // the row amounts are the checkout-time per-order gross snapshots.
    const paidByVendor = new Map()
    for (const p of payRes.data || []) {
      const vid = Number(p.vendor_id)
      const cur = paidByVendor.get(vid) || { paid: true, paid_at: null }
      cur.paid = cur.paid && Boolean(p.paid)
      if (p.paid_at && (!cur.paid_at || String(p.paid_at) > String(cur.paid_at))) cur.paid_at = p.paid_at
      paidByVendor.set(vid, cur)
    }
    const owedByVendor = new Map()
    for (const l of linesRes.data || []) {
      const vid = Number(l.vendor_id)
      owedByVendor.set(vid, (owedByVendor.get(vid) || 0) + Number(l.amount || 0))
    }

    const vendors = (vendorsRes.data || []).map((v) => {
      const gross = owedByVendor.get(Number(v.id)) || 0
      const deduction = Math.round(gross * deductionRate)
      const net = Math.max(0, gross - deduction)
      const paid = paidByVendor.get(Number(v.id))
      return {
        id: Number(v.id),
        name: v.name || '',
        code: v.code || '',
        phone: v.phone || '',
        address: v.address || '',
        gross,
        deduction,
        deduction_rate_pct: deductionRate * 100,
        net,
        paid: Boolean(paid?.paid),
        paid_at: paid?.paid_at || null,
        paid_amount: paid?.paid ? net : 0,
        balance: paid?.paid ? 0 : net,
      }
    })

    return NextResponse.json({
      ok: true,
      cycle: { id: cycleId, name: cycle.name || '', deduction_rate_pct: deductionRate * 100 },
      vendors,
      totals: {
        gross: vendors.reduce((s, v) => s + v.gross, 0),
        deduction: vendors.reduce((s, v) => s + v.deduction, 0),
        net: vendors.reduce((s, v) => s + v.net, 0),
        paid: vendors.filter((v) => v.paid).reduce((s, v) => s + v.net, 0),
        balance: vendors.filter((v) => !v.paid).reduce((s, v) => s + v.net, 0),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load payouts' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const vendorId = Math.trunc(Number(body.vendor_id || 0))
    const cycleId = Math.trunc(Number(body.cycle_id || 0))
    if (!Number.isFinite(vendorId) || vendorId <= 0 || !Number.isFinite(cycleId) || cycleId <= 0) {
      return NextResponse.json({ ok: false, error: 'vendor_id and cycle_id are required' }, { status: 400 })
    }
    const paid = body.paid === true || body.paid === 'true' || body.paid === 1 || body.paid === '1'
    const supabase = createClient()
    const now = new Date().toISOString()

    // The table has one row per (order, vendor), so marking a vendor paid means
    // updating every row for that vendor in the cycle (a plain upsert would fail:
    // there is no unique constraint on (cycle_id, vendor_id)). Only the paid
    // flag is flipped — the per-row `amount` is the checkout-time gross snapshot
    // for that order's lines and must stay untouched, otherwise a multi-order
    // vendor's rows would all be overwritten with the same net figure.
    const { data, error } = await supabase
      .from('exhibition_vendor_payment_status')
      .update({ paid, paid_at: paid ? now : null })
      .eq('cycle_id', cycleId)
      .eq('vendor_id', vendorId)
      .select('id, cycle_id, vendor_id, amount, paid, paid_at')
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, payment: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update payment' }, { status: 500 })
  }
}
