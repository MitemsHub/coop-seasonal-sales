// app/api/rep/exhibition/orders/list/route.js
// Rep view of exhibition orders for their branch. Reps approve, cancel and
// restore; delivery is the vendor's job. The rep_token carries branch_id
// (exhibition is branch-scoped like Food).
//   GET /api/rep/exhibition/orders/list?status=&payment=&cycle_id=&q=&limit=&offset=
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
    const branchId = Math.trunc(Number(claim.branch_id))
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const statusRaw = (searchParams.get('status') || '').trim()
    const status = STATUSES.includes(statusRaw) ? statusRaw : 'Pending'
    const payment = (searchParams.get('payment') || '').trim()
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 1000)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    // Count with the same filters
    let countQ = supabase.from('exhibition_orders').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).eq('status', status)
    if (cycleId > 0) countQ = countQ.eq('cycle_id', cycleId)
    if (payment && ['Cash', 'Savings', 'Loan'].includes(payment)) countQ = countQ.eq('payment_option', payment)
    if (q) countQ = countQ.or(`order_id.ilike.%${q}%,member_id.ilike.%${q}%,member_name_snapshot.ilike.%${q}%`)
    const { count } = await countQ

    let query = supabase
      .from('exhibition_orders')
      .select('id, order_id, cycle_id, branch_id, member_id, member_name_snapshot, payment_option, status, total_qty, total_amount, approved_at, delivered_at, cancelled_at, cancelled_reason, restored_at, created_at, branches:branch_id(name, code), cycles:cycle_id(name, code)')
      .eq('branch_id', branchId)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (cycleId > 0) query = query.eq('cycle_id', cycleId)
    if (payment && ['Cash', 'Savings', 'Loan'].includes(payment)) query = query.eq('payment_option', payment)
    if (q) query = query.or(`order_id.ilike.%${q}%,member_id.ilike.%${q}%,member_name_snapshot.ilike.%${q}%`)

    const { data, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Lines per order (tagged by vendor — the rep needs to see which stand each line came from)
    const orderIds = (data || []).map((o) => o.id)
    let linesByOrder = new Map()
    if (orderIds.length) {
      const { data: lines, error: lErr } = await supabase
        .from('exhibition_order_lines')
        .select('id, order_id, vendor_id, product_name, sku, unit, vendor_price, final_price, qty, amount, delivered, vendors:vendor_id(name)')
        .in('order_id', orderIds)
        .order('id')
      if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })
      for (const l of lines || []) {
        const list = linesByOrder.get(Number(l.order_id)) || []
        list.push({ ...l, vendor_name: l.vendors?.name || '' })
        linesByOrder.set(Number(l.order_id), list)
      }
    }

    const orders = (data || []).map((o) => ({
      ...o,
      branch_name: o.branches?.name || '',
      branch_code: o.branches?.code || '',
      cycle_name: o.cycles?.name || '',
      cycle_code: o.cycles?.code || '',
      lines: linesByOrder.get(o.id) || [],
      per_vendor: (() => {
        const by = new Map()
        for (const l of linesByOrder.get(o.id) || []) {
          const k = l.vendor_id
          const cur = by.get(k) || { vendor_id: k, vendor_name: l.vendor_name || '', qty: 0, amount: 0, all_delivered: true }
          cur.qty += Number(l.qty || 0)
          cur.amount += Number(l.amount || 0)
          cur.all_delivered = cur.all_delivered && Boolean(l.delivered)
          by.set(k, cur)
        }
        return [...by.values()]
      })(),
    }))

    return NextResponse.json({ ok: true, orders, total: count || 0 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load orders', orders: [] }, { status: 500 })
  }
}
