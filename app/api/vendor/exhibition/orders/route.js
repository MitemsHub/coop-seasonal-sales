import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'
import { getVendorContext } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS_FILTERS = ['Pending', 'Approved', 'Delivered', 'Cancelled']

//   GET /api/vendor/exhibition/orders?status=Approved&scope=pending|done|all&q=&limit=&offset=
// Paginated list of the vendor's orders with their lines. `scope` narrows to
// orders where the vendor still owes items ('pending'), has handed over
// everything ('done'), or both ('all'). Returns { ok, orders, total }.
export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const url = new URL(req.url)
    const status = url.searchParams.get('status') || ''
    const q = url.searchParams.get('q') || ''
    const rawScope = url.searchParams.get('scope')
    // Scope semantics: 'pending' = orders where the vendor still owes items;
    // 'done' = the vendor's lines are all handed over (order Approved waiting
    // on others, or fully Delivered); 'all' = both. No scope = legacy mode
    // (the vendor Orders page) where the status filter alone decides.
    const scope = rawScope === 'pending' || rawScope === 'done' ? rawScope : rawScope === 'all' ? 'all' : null
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get('limit') || 50))))
    const offset = Math.max(0, Math.trunc(Number(url.searchParams.get('offset') || 0)))

    // Status filter derived from the scope; legacy mode keeps the passed status.
    let statusFilter = null
    if (scope === 'pending') statusFilter = ['Approved']
    else if (scope === 'done' || scope === 'all') statusFilter = ['Approved', 'Delivered']
    else if (status && STATUS_FILTERS.includes(status)) statusFilter = [status]

    // This vendor's participation per order: how many lines and how many
    // delivered — drives the pending/done scopes. (Per-vendor line counts stay
    // small enough that the in() list below is fine; revisit chunking only if
    // a single vendor ever reaches thousands of orders in one season.)
    const { data: myLines, error: myErr } = await supabase
      .from('exhibition_order_lines')
      .select('order_id, delivered')
      .eq('vendor_id', ctx.vendor_id)
    if (myErr) return NextResponse.json({ error: myErr.message || 'Failed to load orders' }, { status: 500 })

    const progressByOrder = new Map()
    for (const l of myLines || []) {
      const id = Number(l.order_id)
      const cur = progressByOrder.get(id) || { total: 0, done: 0 }
      cur.total += 1
      if (l.delivered) cur.done += 1
      progressByOrder.set(id, cur)
    }

    const ids = []
    for (const [id, p] of progressByOrder) {
      const matches =
        scope == null || scope === 'all' ? true : scope === 'done' ? p.done === p.total : p.done < p.total
      if (matches) ids.push(id)
    }
    if (!ids.length) return NextResponse.json({ ok: true, orders: [], total: 0 })

    // Filter + count + paginate the orders themselves.
    const applyFilters = (queryBuilder) => {
      let b = queryBuilder
      if (statusFilter) b = b.in('status', statusFilter)
      if (q) b = b.or(`order_id.ilike.%${q}%,member_id.ilike.%${q}%,member_name_snapshot.ilike.%${q}%`)
      return b
    }

    let countQ = applyFilters(supabase.from('exhibition_orders').select('id', { count: 'exact', head: true }).in('id', ids))
    const { count } = await countQ

    let query = applyFilters(
      supabase
        .from('exhibition_orders')
        .select('id, order_id, status, member_id, member_name_snapshot, payment_option, total_qty, total_amount, created_at')
        .in('id', ids)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
    )
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message || 'Failed to load orders' }, { status: 500 })

    // This vendor's lines for the paged orders only.
    const pagedIds = (data || []).map((o) => Number(o.id))
    const { data: pagedLines, error: lErr } = await supabase
      .from('exhibition_order_lines')
      .select('id, order_id, product_id, product_name, sku, unit, vendor_price, final_price, qty, amount, delivered, delivered_at')
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
        delivered: Boolean(line.delivered),
        delivered_at: line.delivered_at,
      })
      linesByOrder.set(Number(line.order_id), list)
    }

    const orders = (data || []).map((o) => {
      const lines = linesByOrder.get(Number(o.id)) || []
      const myQty = lines.reduce((s, l) => s + l.qty, 0)
      const myAmount = lines.reduce((s, l) => s + l.amount, 0)
      const doneCount = lines.filter((l) => l.delivered).length
      return {
        ...o,
        db_id: Number(o.id), // numeric exhibition_orders.id — used by the audit endpoint
        member_name: o.member_name_snapshot || '',
        lines,
        my_qty: myQty,
        my_amount: myAmount,
        done_count: doneCount,
        total_lines: lines.length,
        all_delivered: lines.length > 0 && doneCount === lines.length,
      }
    })

    return NextResponse.json({ ok: true, orders, total: count || 0 })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load orders' }, { status: 500 })
  }
}

// POST body: { orderId } or { orderId, lineIds: [id, …] }.
// With just orderId, marks this vendor's lines on that order as delivered
// (the one-tap flow from the Orders page). With lineIds, marks only those
// specific lines — the handover checklist can tick items off one at a time.
// When every line on the order is delivered, the order flips to Delivered
// automatically (member sees the final state).
export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const body = await req.json().catch(() => ({}))
    const orderId = String(body?.orderId || '').trim()
    if (!orderId) return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    const rawLineIds = Array.isArray(body?.lineIds) ? body.lineIds : []
    const lineIds = [...new Set(rawLineIds.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0))]

    const { data: order, error: ordErr } = await supabase
      .from('exhibition_orders')
      .select('id, order_id, status')
      .eq('order_id', orderId)
      .maybeSingle()
    if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.status === 'Cancelled') return NextResponse.json({ error: 'This order is cancelled' }, { status: 409 })
    if (order.status === 'Delivered') return NextResponse.json({ error: 'This order is already delivered' }, { status: 409 })
    if (order.status !== 'Approved') {
      return NextResponse.json({ error: 'Only approved orders can be marked delivered' }, { status: 409 })
    }

    // This vendor's lines on the order
    const { data: myLines } = await supabase
      .from('exhibition_order_lines')
      .select('id')
      .eq('order_id', order.id)
      .eq('vendor_id', ctx.vendor_id)
    if (!myLines?.length) return NextResponse.json({ error: 'No items from your stand on this order' }, { status: 404 })

    // When lineIds are given, deliver only those (and only if they belong to
    // this vendor and this order); otherwise deliver the whole order.
    const myIds = new Set((myLines || []).map((l) => Number(l.id)))
    const targetIds = lineIds.length ? lineIds.filter((id) => myIds.has(id)) : [...myIds]
    if (!targetIds.length) {
      return NextResponse.json({ error: 'No matching items from your stand on this order' }, { status: 404 })
    }

    const { error: upErr } = await supabase
      .from('exhibition_order_lines')
      .update({ delivered: true, delivered_at: new Date().toISOString() })
      .in('id', targetIds)
      .eq('order_id', order.id)
      .eq('vendor_id', ctx.vendor_id)
      .eq('delivered', false)
    if (upErr) return NextResponse.json({ error: upErr.message || 'Failed to update' }, { status: 500 })

    // Check whether every line across ALL vendors is now delivered
    const { data: allLines } = await supabase
      .from('exhibition_order_lines')
      .select('delivered')
      .eq('order_id', order.id)
    const allDone = Array.isArray(allLines) && allLines.length > 0 && allLines.every((l) => l.delivered)

    if (allDone) {
      await supabase
        .from('exhibition_orders')
        .update({ status: 'Delivered', delivered_at: new Date().toISOString() })
        .eq('id', order.id)
      await logExhibitionAudit([order.id], {
        action: 'Delivered',
        actorType: 'vendor',
        actorLabel: `Vendor · ${ctx.vendor_code || ''}`,
      })
    }

    return NextResponse.json({ ok: true, order_delivered: allDone })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to mark delivered' }, { status: 500 })
  }
}
