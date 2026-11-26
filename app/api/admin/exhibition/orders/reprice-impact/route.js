// app/api/admin/exhibition/orders/reprice-impact/route.js
// GET /api/admin/exhibition/orders/reprice-impact?cycle_id=
//
// Read-only preview of what a reprice would do to members' loan room, so the
// admin can see who is about to be pushed over their limit BEFORE the numbers
// settle. It calculates the paying price of every order the repricer will move
// — Pending, Approved, Confirmed and Delivered, i.e. everything that counts
// against room — exactly the way the repricer does — product price less approved
// discount, plus the season's current loan rate — and asks the same
// check_exhibition_exposure_atomic function the checkout uses for each
// member's remaining room, so nothing here invents its own arithmetic.
//
// Nothing is written: the totals compared below are computed, not stored.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { queryDirect } from '@/lib/directDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unitPriceExpr(hasDiscount) {
  if (!hasDiscount) return 'p.vendor_price::numeric'
  return `GREATEST(0::numeric, ROUND(p.vendor_price::numeric * (100 - LEAST(GREATEST(COALESCE(p.discount_pct, 0), 0), 90)) / 100))`
}

function buildSql(hasDiscount) {
  const unit = unitPriceExpr(hasDiscount)
  return `
    WITH open_orders AS (
      SELECT o.id,
             o.order_id,
             o.member_id,
             o.member_name_snapshot,
             o.payment_option,
             o.total_amount AS old_total,
             COALESCE(c.loan_interest_rate_pct, 0)::numeric AS rate
        FROM public.exhibition_orders o
        JOIN public.exhibition_cycles c ON c.id = o.cycle_id
       WHERE o.cycle_id = $1
         AND o.status IN ('Pending', 'Approved', 'Confirmed', 'Delivered')
    ),
    priced AS (
      SELECT l.order_id,
             l.qty::numeric AS qty,
             CASE
               WHEN l.product_id IS NOT NULL AND p.id IS NOT NULL
                 THEN ${unit}
               ELSE l.final_price::numeric
             END AS unit_price
        FROM public.exhibition_order_lines l
        JOIN open_orders oo ON oo.id = l.order_id
        LEFT JOIN public.exhibition_products p ON p.id = l.product_id
    ),
    totals AS (
      SELECT x.order_id, SUM(x.unit_price * x.qty) AS principal
        FROM priced x
       GROUP BY x.order_id
    )
    SELECT oo.id,
           oo.order_id,
           oo.member_id,
           oo.member_name_snapshot,
           oo.payment_option,
           oo.old_total,
           (tot.principal + CASE WHEN oo.payment_option = 'Loan'
                                 THEN ROUND(tot.principal * oo.rate / 100)
                                 ELSE 0 END)::bigint AS new_total
      FROM open_orders oo
      JOIN totals tot ON tot.order_id = oo.id
     ORDER BY oo.member_id, oo.id
  `
}

// The RPC locks the member row for its own statement; a handful at a time is
// plenty for a page of orders and keeps the pool healthy.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const supabase = createClient()

    let cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      const { data: active } = await supabase
        .from('exhibition_cycles')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .maybeSingle()
      if (!active?.id) {
        return NextResponse.json({ ok: false, error: 'No active exhibition season to check.' }, { status: 400 })
      }
      cycleId = Number(active.id)
    }

    const { data: cycle, error: cycErr } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, loan_interest_rate_pct')
      .eq('id', cycleId)
      .maybeSingle()
    if (cycErr) return NextResponse.json({ ok: false, error: cycErr.message }, { status: 500 })
    if (!cycle) return NextResponse.json({ ok: false, error: 'Exhibition season not found' }, { status: 404 })

    let hasDiscount = true
    try {
      const col = await queryDirect(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'exhibition_products' AND column_name = 'discount_pct'`
      )
      hasDiscount = (col?.rows?.length || 0) > 0
    } catch {
      hasDiscount = false
    }

    const { rows } = await queryDirect(buildSql(hasDiscount), [cycleId])
    const orders = (rows || []).map((r) => ({
      id: Number(r.id),
      order_id: r.order_id,
      member_id: String(r.member_id || '').trim().toUpperCase(),
      member_name: r.member_name_snapshot || '',
      payment_option: r.payment_option || '',
      old_total: Number(r.old_total || 0),
      new_total: Number(r.new_total || 0),
      delta: Number(r.new_total || 0) - Number(r.old_total || 0),
    }))

    // Group by member; loan room only matters for a member holding Loan orders,
    // but the room is reported for everyone so the admin can see the shape of
    // the season in one place.
    const byMember = new Map()
    for (const o of orders) {
      if (!o.member_id) continue
      const cur = byMember.get(o.member_id) || { member_id: o.member_id, name: o.member_name, orders: [] }
      cur.orders.push(o)
      byMember.set(o.member_id, cur)
    }

    const memberIds = [...byMember.keys()]
    const { data: members } = memberIds.length
      ? await supabase
          .from('members')
          .select('member_id, full_name, category, savings, loans, global_limit')
          .in('member_id', memberIds)
      : { data: [] }
    const memberById = new Map((members || []).map((m) => [String(m.member_id || '').trim().toUpperCase(), m]))

    const list = await mapLimit(memberIds, 6, async (memberId) => {
      const group = byMember.get(memberId)
      const member = memberById.get(memberId) || {}
      const loanOrders = group.orders.filter((o) => o.payment_option === 'Loan')
      const oldLoan = loanOrders.reduce((s, o) => s + o.old_total, 0)
      const newLoan = loanOrders.reduce((s, o) => s + o.new_total, 0)
      const delta = newLoan - oldLoan

      // p_total_amount = 0 returns the room left right now, counting every
      // Pending/Approved/Confirmed order already on the books.
      let loanRoom = null
      let roomWarning = ''
      const { data: exposure, error: expErr } = await supabase.rpc('check_exhibition_exposure_atomic', {
        p_member_id: memberId,
        p_payment_option: 'Loan',
        p_total_amount: 0,
        p_cycle_id: cycleId,
      })
      if (expErr) roomWarning = expErr.message || 'Could not read the loan room.'
      else if (exposure?.ok) loanRoom = Number(exposure.loanEligible || 0)
      else {
        // "Loan option is not available" for a member with no room left is a
        // zero room, not a failure; anything else is a real warning.
        const msg = String(exposure?.error || '')
        if (/not available/i.test(msg)) loanRoom = 0
        else roomWarning = msg || 'Could not read the loan room.'
      }

      const roomNow = loanRoom == null ? null : loanRoom
      const roomAfter = roomNow == null ? null : roomNow - delta
      const overBy = roomAfter != null && roomAfter < 0 ? -roomAfter : 0

      return {
        member_id: memberId,
        name: member.full_name || group.name || '',
        category: member.category || '',
        savings: Number(member.savings || 0),
        loans: Number(member.loans || 0),
        global_limit: Number(member.global_limit || 0),
        loan_orders: loanOrders.length,
        exposure_now: oldLoan,
        exposure_after: newLoan,
        total_delta: delta,
        room_now: roomNow,
        room_after: roomAfter,
        over_by: overBy,
        room_warning: roomWarning,
        orders: group.orders,
      }
    })

    const sorted = list
      .filter(Boolean)
      .sort((a, b) => b.over_by - a.over_by || a.member_id.localeCompare(b.member_id))
    const over = sorted.filter((m) => m.over_by > 0)

    return NextResponse.json({
      ok: true,
      cycle: { id: cycleId, name: cycle.name, code: cycle.code, status: cycle.status },
      loan_interest_rate_pct: Number(cycle.loan_interest_rate_pct || 0),
      discount_applied: hasDiscount,
      scanned_orders: orders.length,
      loan_orders: orders.filter((o) => o.payment_option === 'Loan').length,
      total_delta: orders.reduce((s, o) => s + o.delta, 0),
      members_checked: sorted.length,
      over_members: over.length,
      over_orders: over.reduce((s, m) => s + m.orders.filter((o) => o.delta > 0).length, 0),
      members: sorted,
    })
  } catch (e) {
    console.error('Reprice impact failed:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Failed to check the loan room' }, { status: 500 })
  }
}
