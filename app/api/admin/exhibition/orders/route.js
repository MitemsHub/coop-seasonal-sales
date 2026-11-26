// app/api/admin/exhibition/orders/route.js
// Admin list of exhibition orders with their per-vendor lines.
//   GET /api/admin/exhibition/orders?status=Pending&cycle_id=&q=&payment=&limit=&offset=
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['Pending', 'Approved', 'Confirmed', 'Cancelled']

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const status = String(searchParams.get('status') || '')
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    const branchId = Math.trunc(Number(searchParams.get('branch_id') || 0))
    const payment = String(searchParams.get('payment') || '')
    const q = String(searchParams.get('q') || '').trim()
    const from = String(searchParams.get('from') || '')
    const to = String(searchParams.get('to') || '')
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(searchParams.get('limit') || 100))))
    const offset = Math.max(0, Math.trunc(Number(searchParams.get('offset') || 0)))

    const supabase = createClient()

    // Count first (same filters)
    let countQ = supabase.from('exhibition_orders').select('id', { count: 'exact', head: true })
    if (status && STATUSES.includes(status)) countQ = countQ.eq('status', status)
    else countQ = countQ.neq('status', 'Cancelled')
    if (cycleId > 0) countQ = countQ.eq('cycle_id', cycleId)
    if (branchId > 0) countQ = countQ.eq('branch_id', branchId)
    if (payment) countQ = countQ.eq('payment_option', payment)
    if (q) countQ = countQ.or(`order_id.ilike.%${q}%,member_id.ilike.%${q}%,member_name_snapshot.ilike.%${q}%`)
    if (from) countQ = countQ.gte('created_at', from)
    if (to) countQ = countQ.lte('created_at', to + 'T23:59:59')
    const { count } = await countQ

    let query = supabase
      .from('exhibition_orders')
      .select('*, branches:branch_id(name, code), cycles:cycle_id(name, code)')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status && STATUSES.includes(status)) query = query.eq('status', status)
    else query = query.neq('status', 'Cancelled')
    if (cycleId > 0) query = query.eq('cycle_id', cycleId)
    if (branchId > 0) query = query.eq('branch_id', branchId)
    if (payment) query = query.eq('payment_option', payment)
    if (q) query = query.or(`order_id.ilike.%${q}%,member_id.ilike.%${q}%,member_name_snapshot.ilike.%${q}%`)
    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to + 'T23:59:59')

    const { data, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    // Lines per order (tagged by vendor)
    const orderIds = (data || []).map((o) => o.id)
    let linesByOrder = new Map()
    if (orderIds.length) {
      const { data: lines, error: lErr } = await supabase
        .from('exhibition_order_lines')
        .select('id, order_id, vendor_id, product_name, sku, unit, vendor_price, final_price, qty, amount, vendors:vendor_id(name)')
        .in('order_id', orderIds)
        .order('id')
      if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })
      for (const l of lines || []) {
        const list = linesByOrder.get(Number(l.order_id)) || []
        list.push({ ...l, vendor_name: l.vendors?.name || '' })
        linesByOrder.set(Number(l.order_id), list)
      }
    }

    // The admin needs to call the member about a collection, so each row also
    // carries the member's phone plus the two things the approver otherwise
    // has to go hunting for: how often this member orders, and how much room
    // they have left. Both are read live — nothing is stored per order.
    const memberIds = [...new Set((data || []).map((o) => String(o.member_id || '').trim().toUpperCase()).filter(Boolean))]
    const memberById = new Map()
    const historyByMember = new Map()
    if (memberIds.length) {
      const [{ data: members, error: memErr }, { data: history }] = await Promise.all([
        supabase
          .from('members')
          .select('member_id, phone, category, savings, loans, global_limit')
          .in('member_id', memberIds),
        supabase
          .from('exhibition_orders')
          .select('member_id, status, cycle_id')
          .in('member_id', memberIds),
      ])
      if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 })
      for (const m of members || []) {
        memberById.set(String(m.member_id || '').trim().toUpperCase(), m)
      }
      for (const h of history || []) {
        const key = String(h.member_id || '').trim().toUpperCase()
        const cur = historyByMember.get(key) || { total: 0, cancelled: 0, open: 0, confirmed: 0, byCycle: new Map() }
        cur.total += 1
        if (h.status === 'Cancelled') cur.cancelled += 1
        else if (h.status === 'Confirmed') cur.confirmed += 1
        else cur.open += 1
        const cid = Number(h.cycle_id || 0)
        cur.byCycle.set(cid, (cur.byCycle.get(cid) || 0) + 1)
        historyByMember.set(key, cur)
      }
    }

    // Remaining room comes from the same function checkout enforces. One call
    // per member+season, shared by every order on the page.
    const roomByScope = new Map()
    const scopes = [...new Set(
      (data || [])
        .map((o) => `${String(o.member_id || '').trim().toUpperCase()}|${Number(o.cycle_id || 0)}`)
        .filter((k) => !k.startsWith('|'))
    )]
    for (let i = 0; i < scopes.length; i += 6) {
      const chunk = scopes.slice(i, i + 6)
      const settled = await Promise.all(chunk.map(async (key) => {
        const [memberId, cyclePart] = key.split('|')
        const cycleId = Number(cyclePart || 0)
        if (!cycleId) return [key, { available: false, warning: 'No season on this order.' }]
        const { data: exposure, error } = await supabase.rpc('check_exhibition_exposure_atomic', {
          p_member_id: memberId,
          p_payment_option: 'Loan',
          p_total_amount: 0,
          p_cycle_id: cycleId,
        })
        if (error) return [key, { available: false, warning: error.message || 'Could not read loan room.' }]
        if (exposure?.ok) {
          return [key, {
            available: true,
            loan_room: Number(exposure.loanEligible || 0),
            savings_room: Number(exposure.savingsEligible || 0),
            warning: '',
          }]
        }
        // 'Loan option is not available' / an exceeded cap both mean the room
        // is already gone, which is information — not a failed lookup.
        const msg = String(exposure?.error || '')
        if (/not available|exceeded|already been used/i.test(msg)) {
          return [key, { available: true, loan_room: 0, savings_room: 0, warning: msg }]
        }
        return [key, { available: false, warning: msg || 'Could not read loan room.' }]
      }))
      for (const [key, value] of settled) {
        roomByScope.set(key, value)
      }
    }

    const orders = (data || []).map((o) => {
      const key = String(o.member_id || '').trim().toUpperCase()
      const member = memberById.get(key) || {}
      const hist = historyByMember.get(key) || { total: 0, cancelled: 0, open: 0, confirmed: 0, byCycle: new Map() }
      const room = roomByScope.get(`${key}|${Number(o.cycle_id || 0)}`) || { available: false, warning: '' }
      return {
      ...o,
      member_phone: String(member.phone || '').trim(),
      // What the approver needs at a glance: is this a first-time or repeat
      // buyer, how many of their orders are still open, and does the season's
      // room still cover what they already hold.
      member_approval: {
        orders_total: hist.total,
        orders_open: hist.open,
        orders_confirmed: hist.confirmed,
        orders_cancelled: hist.cancelled,
        orders_this_cycle: hist.byCycle.get(Number(o.cycle_id || 0)) || 0,
        first_order: hist.total <= 1,
        category: String(member.category || '').trim(),
        savings: Number(member.savings || 0),
        loans: Number(member.loans || 0),
        global_limit: Number(member.global_limit || 0),
        loan_room: room.available ? Number(room.loan_room || 0) : null,
        savings_room: room.available ? Number(room.savings_room || 0) : null,
        room_available: Boolean(room.available),
        room_warning: room.warning || '',
      },
      branch_name: o.branches?.name || '',
      branch_code: o.branches?.code || '',
      cycle_name: o.cycles?.name || '',
      cycle_code: o.cycles?.code || '',
      lines: linesByOrder.get(o.id) || [],
      per_vendor: (() => {
        const by = new Map()
        for (const l of linesByOrder.get(o.id) || []) {
          const k = l.vendor_id
          const cur = by.get(k) || { vendor_id: k, vendor_name: l.vendor_name || '', qty: 0, amount: 0 }
          cur.qty += Number(l.qty || 0)
          cur.amount += Number(l.amount || 0)
          by.set(k, cur)
        }
        return [...by.values()]
      })(),
      }
    })

    return NextResponse.json({ ok: true, orders, total: count || 0 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load orders' }, { status: 500 })
  }
}
