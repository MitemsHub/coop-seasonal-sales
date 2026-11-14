// app/api/vendor/exhibition/orders/route.js
// A vendor's exhibition orders. The shop and the counter invoice both land in
// Pending; the admin approves; the member confirms receipt. Vendors prepare
// and hand over the goods, but do not change the order status.
//
//   GET /api/vendor/exhibition/orders?status=&q=&limit=&offset=
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS_FILTERS = ['Pending', 'Approved', 'Confirmed', 'Cancelled']

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const url = new URL(req.url)
    const status = url.searchParams.get('status') || ''
    const q = url.searchParams.get('q') || ''
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get('limit') || 50))))
    const offset = Math.max(0, Math.trunc(Number(url.searchParams.get('offset') || 0)))

    // Which orders contain this vendor's lines?
    const { data: myLines, error: myErr } = await supabase
      .from('exhibition_order_lines')
      .select('order_id')
      .eq('vendor_id', ctx.vendor_id)
    if (myErr) return NextResponse.json({ error: myErr.message || 'Failed to load orders' }, { status: 500 })

    const ids = [...new Set((myLines || []).map((l) => Number(l.order_id)).filter((n) => Number.isFinite(n) && n > 0))]
    if (!ids.length) return NextResponse.json({ ok: true, orders: [], total: 0 })

    const applyFilters = (builder) => {
      let next = builder.in('id', ids)
      if (status && STATUS_FILTERS.includes(status)) next = next.eq('status', status)
      else next = next.in('status', STATUS_FILTERS)
      if (q) next = next.or(`order_id.ilike.%${q}%,member_id.ilike.%${q}%,member_name_snapshot.ilike.%${q}%`)
      return next
    }

    const { count } = await applyFilters(
      supabase.from('exhibition_orders').select('id', { count: 'exact', head: true })
    )

    const { data, error } = await applyFilters(
      supabase
        .from('exhibition_orders')
        .select('id, order_id, status, member_id, member_name_snapshot, payment_option, total_qty, total_amount, created_at, approved_at, member_confirmed_at, confirmed_by_role, branches:branch_id(name, code), cycles:cycle_id(name, code)')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
    )
    if (error) return NextResponse.json({ error: error.message || 'Failed to load orders' }, { status: 500 })

    const pagedIds = (data || []).map((o) => Number(o.id))
    const { data: pagedLines, error: lErr } = await supabase
      .from('exhibition_order_lines')
      .select('id, order_id, product_name, sku, unit, vendor_price, final_price, qty, amount, note')
      .eq('vendor_id', ctx.vendor_id)
      .in('order_id', pagedIds)
      .order('id')
    if (lErr) return NextResponse.json({ error: lErr.message || 'Failed to load orders' }, { status: 500 })

    const linesByOrder = new Map()
    for (const line of pagedLines || []) {
      const list = linesByOrder.get(Number(line.order_id)) || []
      list.push({
        id: line.id,
        product_name: line.product_name || '',
        sku: line.sku || '',
        unit: line.unit || 'each',
        qty: Number(line.qty || 0),
        final_price: Number(line.final_price || 0),
        amount: Number(line.amount || 0),
        note: line.note || '',
      })
      linesByOrder.set(Number(line.order_id), list)
    }

    const orders = (data || []).map((o) => {
      const lines = linesByOrder.get(Number(o.id)) || []
      const myQty = lines.reduce((s, l) => s + l.qty, 0)
      const myAmount = lines.reduce((s, l) => s + l.amount, 0)
      return {
        ...o,
        db_id: Number(o.id),
        member_name: o.member_name_snapshot || '',
        branch_name: o.branches?.name || '',
        branch_code: o.branches?.code || '',
        cycle_name: o.cycles?.name || '',
        cycle_code: o.cycles?.code || '',
        lines,
        my_qty: myQty,
        my_amount: myAmount,
      }
    })

    return NextResponse.json({ ok: true, orders, total: count || 0 })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load orders' }, { status: 500 })
  }
}
