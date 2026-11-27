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

// A stand only sees an invoice once the admin has approved it. Until then the
// order can still be edited, re-priced or withdrawn, and goods picked against
// a pending invoice are goods nobody may collect. `approved_at` is what
// separates an order that was approved and later cancelled from one that was
// cancelled before it ever reached the floor.
const STATUS_FILTERS = ['Approved', 'Confirmed', 'Cancelled']

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
      let next = builder.in('id', ids).not('approved_at', 'is', null)
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

    // The stand calls the member to arrange collection, so the number travels
    // with the order (members has no FK from exhibition_orders to embed).
    const memberIds = [...new Set((data || []).map((o) => String(o.member_id || '').trim()).filter(Boolean))]
    const phoneByMember = new Map()
    if (memberIds.length) {
      const { data: memberRows } = await supabase
        .from('members')
        .select('member_id, phone')
        .in('member_id', memberIds)
      for (const m of memberRows || []) {
        phoneByMember.set(String(m.member_id || '').trim(), String(m.phone || '').trim())
      }
    }

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

    // Cancel now clears this stand's own items on any open order, shared or
    // not: on a mixed invoice the other stands keep theirs and the order stays
    // open. The list still reports `shared` so the button can say so before it
    // acts — the vendor is not cancelling goods it does not own.
    const { data: allPagedLines } = await supabase
      .from('exhibition_order_lines')
      .select('order_id')
      .in('order_id', pagedIds)
    const totalLinesByOrder = new Map()
    for (const line of allPagedLines || []) {
      const oid = Number(line.order_id)
      totalLinesByOrder.set(oid, (totalLinesByOrder.get(oid) || 0) + 1)
    }

    const orders = (data || []).map((o) => {
      const lines = linesByOrder.get(Number(o.id)) || []
      const myQty = lines.reduce((s, l) => s + l.qty, 0)
      const myAmount = lines.reduce((s, l) => s + l.amount, 0)
      const totalLines = totalLinesByOrder.get(Number(o.id)) || lines.length
      return {
        ...o,
        db_id: Number(o.id),
        member_name: o.member_name_snapshot || '',
        member_phone: phoneByMember.get(String(o.member_id || '').trim()) || '',
        branch_name: o.branches?.name || '',
        branch_code: o.branches?.code || '',
        cycle_name: o.cycles?.name || '',
        cycle_code: o.cycles?.code || '',
        lines,
        my_qty: myQty,
        my_amount: myAmount,
        my_lines: lines.length,
        total_lines: totalLines,
        // Pending/approved with at least one of this stand's items. On a shared
        // invoice cancel takes off only this stand's goods and recalculates the
        // order; when it is the only stand the order is cancelled outright.
        can_cancel: ['Pending', 'Approved'].includes(String(o.status)) && lines.length > 0,
        // Item-level withdrawal works on any open order, shared or not: the
        // server recalculates the surviving lines and the order total.
        can_cancel_lines: ['Pending', 'Approved'].includes(String(o.status)) && lines.length > 0,
        shared: totalLines > lines.length,
      }
    })

    return NextResponse.json({ ok: true, orders, total: count || 0 })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load orders' }, { status: 500 })
  }
}
