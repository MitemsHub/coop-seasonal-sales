// app/api/admin/exhibition/vendors/breakdown/route.js
// Per-vendor handover breakdown for the admin, aggregated across ALL branches.
// Across every branch's APPROVED orders in the active cycles, which vendors
// still owe goods — i.e. lines the vendor has not yet marked delivered.
// Powers the vendor handover panel on the admin Approved view (the superuser
// equivalent of the rep's branch-scoped panel).
//   GET /api/admin/exhibition/vendors/breakdown?cycle_id=NNN
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const requestedCycle = Math.trunc(Number(new URL(req.url).searchParams.get('cycle_id') || 0))

    // Approved orders across every branch. Optionally scoped to one cycle
    // (the page's cycle filter); otherwise cover all cycles.
    let orderQ = supabase.from('exhibition_orders').select('id, cycle_id').eq('status', 'Approved')
    if (Number.isFinite(requestedCycle) && requestedCycle > 0) orderQ = orderQ.eq('cycle_id', requestedCycle)
    const { data: approved, error: oErr } = await orderQ
    if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 })

    const orderIds = (approved || []).map((o) => o.id)
    const cycleIds = [...new Set((approved || []).map((o) => o.cycle_id).filter(Boolean))]

    // Cycle names for the panel subtitle (fetching separately — orders has no
    // FK to exhibition_cycles via PostgREST in this schema).
    const { data: cycleRows } = cycleIds.length
      ? await supabase.from('exhibition_cycles').select('id, name, branch_id, branches:branch_id(name)').in('id', cycleIds)
      : { data: [] }
    const cycleNameMap = new Map((cycleRows || []).map((c) => [Number(c.id), c.name || '']))
    const branchNameByCycle = new Map((cycleRows || []).map((c) => [Number(c.id), c.branches?.name || '']))

    const vendors = []
    if (orderIds.length) {
      const { data: lines, error: lErr } = await supabase
        .from('exhibition_order_lines')
        .select('id, order_id, vendor_id, product_name, qty, amount, delivered, vendors:vendor_id(id, name, branches:branch_id(name))')
        .in('order_id', orderIds)
        .order('id')
      if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })

      const by = new Map()
      for (const l of lines || []) {
        const k = l.vendor_id
        const cur = by.get(k) || {
          vendor_id: k,
          vendor_name: l.vendors?.name || '',
          branch_name: l.vendors?.branches?.name || '',
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
          branch_name: v.branch_name,
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

    return NextResponse.json({
      ok: true,
      cycles: (cycleRows || []).map((c) => ({
        id: Number(c.id),
        name: c.name || '',
        branch_name: c.branches?.name || '',
      })),
      cycle_names: Object.fromEntries(cycleNameMap),
      branch_names: Object.fromEntries(branchNameByCycle),
      vendors,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load vendor breakdown' }, { status: 500 })
  }
}
