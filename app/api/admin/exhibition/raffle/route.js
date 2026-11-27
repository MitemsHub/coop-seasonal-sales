// app/api/admin/exhibition/raffle/route.js
// Raffle desk: which members bought enough this season to earn a ticket.
//   GET /api/admin/exhibition/raffle?cycle_id=...&min_amount=1000000
//
// Qualifying spend is the sum of the member's exhibition orders in the season,
// with cancelled orders left out — a cancelled order was never a purchase, so
// it must not buy a ticket. Each qualifying member gets one ticket; the page
// draws the winner, this route only decides who is in the hat.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE = 1000
const DEFAULT_MIN = 1000000

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    const rawMin = Number(searchParams.get('min_amount'))
    const minAmount = Number.isFinite(rawMin) && rawMin >= 0 ? rawMin : DEFAULT_MIN

    const supabase = createClient()

    // ── Seasons (for the picker) ─────────────────────────────────────
    const { data: cycles, error: cycleError } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, starts_at, ends_at')
      .order('created_at', { ascending: false })
    if (cycleError) return NextResponse.json({ ok: false, error: cycleError.message }, { status: 500 })

    const list = cycles || []
    const cycle =
      list.find((c) => Number(c.id) === cycleId) ||
      list.find((c) => c.status === 'active') ||
      list[0] ||
      null

    if (!cycle) {
      return NextResponse.json({
        ok: true,
        cycles: [],
        cycle: null,
        min_amount: minAmount,
        entries: [],
        totals: { members: 0, orders: 0, amount: 0 },
      })
    }

    // ── Every counting order in the season ───────────────────────────
    const orders = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('exhibition_orders')
        .select('id, order_id, member_id, member_name_snapshot, total_amount, status, created_at')
        .eq('cycle_id', Number(cycle.id))
        .neq('status', 'Cancelled')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      const chunk = data || []
      orders.push(...chunk)
      if (chunk.length < PAGE) break
    }

    const byMember = new Map()
    for (const o of orders) {
      const key = String(o.member_id || '').trim().toUpperCase()
      if (!key) continue
      const cur = byMember.get(key) || {
        member_id: key,
        member_name: '',
        orders: 0,
        amount: 0,
        last_order_at: null,
      }
      cur.orders += 1
      cur.amount += Number(o.total_amount || 0)
      if (!cur.member_name && o.member_name_snapshot) cur.member_name = String(o.member_name_snapshot)
      if (o.created_at && (!cur.last_order_at || o.created_at > cur.last_order_at)) cur.last_order_at = o.created_at
      byMember.set(key, cur)
    }

    const qualifying = [...byMember.values()].filter((m) => m.amount >= minAmount)

    // Names and phone numbers for the qualifying members only.
    const detail = new Map()
    const ids = qualifying.map((m) => m.member_id)
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const { data } = await supabase
        .from('members')
        .select('member_id, full_name, phone, branches:branch_id(name, code)')
        .in('member_id', chunk)
      for (const m of data || []) {
        detail.set(String(m.member_id || '').trim().toUpperCase(), m)
      }
    }

    const entries = qualifying
      .map((m) => {
        const row = detail.get(m.member_id) || {}
        return {
          member_id: m.member_id,
          member_name: row.full_name || m.member_name || '',
          phone: row.phone || '',
          branch_name: row.branches?.name || '',
          branch_code: row.branches?.code || '',
          orders: m.orders,
          amount: m.amount,
          last_order_at: m.last_order_at,
        }
      })
      .sort((a, b) => b.amount - a.amount)

    return NextResponse.json({
      ok: true,
      cycles: list.map((c) => ({
        id: Number(c.id),
        name: c.name || '',
        code: c.code || '',
        status: c.status || '',
        starts_at: c.starts_at || null,
        ends_at: c.ends_at || null,
      })),
      cycle: {
        id: Number(cycle.id),
        name: cycle.name || '',
        code: cycle.code || '',
        status: cycle.status || '',
        starts_at: cycle.starts_at || null,
        ends_at: cycle.ends_at || null,
      },
      min_amount: minAmount,
      entries,
      totals: {
        members: entries.length,
        orders: entries.reduce((sum, e) => sum + e.orders, 0),
        amount: entries.reduce((sum, e) => sum + e.amount, 0),
        shopping_members: byMember.size,
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load raffle entries' }, { status: 500 })
  }
}
