// app/api/admin/exhibition/checker/route.js
// The Checker desk: one member ID in, their whole exhibition position out —
// balances, entitlements, food orders, then each shopping day of the season in
// order, with a closing balance at the end.
//   GET /api/admin/exhibition/checker?member_id=...&cycle_id=...
//
// The day-by-day ledger is built from the orders themselves (nothing stored),
// so it stays correct when an order is approved, cancelled or repriced. A
// cancelled order is left out: it was never a purchase, and counting it would
// make the closing balance disagree with the member's savings.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COUNTED_FOOD = ['Pending', 'Posted', 'Delivered']

// Group by the calendar day the desk sees, not the server's UTC day: a 00:30
// order in Lagos would otherwise land on the previous day's line.
const LAGOS_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function dayKey(iso) {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return String(iso).slice(0, 10)
  return LAGOS_DAY.format(parsed)
}

function dayLabel(ymd) {
  const parsed = new Date(`${ymd}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return ymd
  return parsed.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const memberId = String(searchParams.get('member_id') || '').trim().toUpperCase()
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    if (!memberId) return NextResponse.json({ ok: false, error: 'Member ID is required' }, { status: 400 })

    const supabase = createClient()

    // ── Member ────────────────────────────────────────────────────────
    const memberSelect = `
      member_id,
      full_name,
      phone,
      grade,
      category,
      savings,
      loans,
      global_limit,
      branches:branch_id(name, code)
    `
    let { data: member, error: memberError } = await supabase
      .from('members')
      .select(memberSelect)
      .eq('member_id', memberId)
      .maybeSingle()
    // `grade` / `phone` are newer columns; keep the desk working on a database
    // that has not been migrated yet.
    if (memberError && /column|does not exist/i.test(memberError.message || '')) {
      ;({ data: member, error: memberError } = await supabase
        .from('members')
        .select('member_id, full_name, category, savings, loans, global_limit, branches:branch_id(name, code)')
        .eq('member_id', memberId)
        .maybeSingle())
    }
    if (memberError) return NextResponse.json({ ok: false, error: memberError.message }, { status: 500 })
    if (!member) {
      // A desk remembers a name, or half an ID, long before it remembers the
      // exact member number — and typing one on a phone is where the mistake
      // happens. Offer the closest matches so the officer taps a member instead
      // of retyping an ID that may be right or wrong.
      //
      // The term goes into a PostgREST `or` filter, so the characters that
      // grammar treats as syntax are stripped rather than escaped.
      const needle = memberId.replace(/[(),%_*"\\]/g, ' ').replace(/\s+/g, ' ').trim()
      let suggestions = []
      if (needle.length >= 2) {
        const { data } = await supabase
          .from('members')
          .select('member_id, full_name, branches:branch_id(name, code)')
          .or(`member_id.ilike.%${needle}%,full_name.ilike.%${needle}%`)
          .order('member_id', { ascending: true })
          .limit(8)
        suggestions = (data || []).map((m) => ({
          member_id: m.member_id,
          full_name: m.full_name || '',
          branch_name: m.branches?.name || '',
        }))
      }
      return NextResponse.json({ ok: false, error: 'Member not found', suggestions }, { status: 404 })
    }

    // ── Season ────────────────────────────────────────────────────────
    // `*` because the loan-room note below needs the season's grace/pool
    // columns, and a hand-written list would break the whole desk on a
    // database that has not taken the newest cycle migration yet.
    let cycle = null
    if (cycleId > 0) {
      const { data } = await supabase
        .from('exhibition_cycles')
        .select('*')
        .eq('id', cycleId)
        .maybeSingle()
      cycle = data || null
    } else {
      const { data: active } = await supabase
        .from('exhibition_cycles')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      cycle = active || null
      if (!cycle) {
        const { data: latest } = await supabase
          .from('exhibition_cycles')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        cycle = latest || null
      }
    }

    // ── Food orders ──────────────────────────────────────────────────
    // Food is a separate module with its own cycle. When a food cycle is
    // active only that cycle counts (the same rule as the exposure maths);
    // with none active, the year's orders are shown.
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()
    let foodCycle = null
    try {
      const { data } = await supabase
        .from('cycles')
        .select('id, name')
        .eq('is_active', true)
        .maybeSingle()
      foodCycle = data || null
    } catch {}

    let foodQuery = supabase
      .from('orders')
      .select('order_id, status, total_amount, payment_option, created_at')
      .eq('member_id', memberId)
      .in('status', COUNTED_FOOD)
      .order('created_at', { ascending: true })
    foodQuery = foodCycle?.id ? foodQuery.eq('cycle_id', foodCycle.id) : foodQuery.gte('created_at', yearStart)

    const foodRes = await foodQuery
    if (foodRes.error) {
      return NextResponse.json({ ok: false, error: foodRes.error.message }, { status: 500 })
    }
    const foodOrders = foodRes.data || []

    // ── Exhibition orders of this season ─────────────────────────────
    let exhibitionOrders = []
    if (cycle?.id) {
      const { data, error } = await supabase
        .from('exhibition_orders')
        .select('id, order_id, status, total_amount, payment_option, created_at')
        .eq('member_id', memberId)
        .eq('cycle_id', Number(cycle.id))
        .neq('status', 'Cancelled')
        .order('created_at', { ascending: true })
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      exhibitionOrders = data || []
    }

    // ── What a loan order moved in the loan room ─────────────────────
    // The season decides the basis: when interest is excluded, the loan room is
    // debited by the goods value (the order's line amounts), not by the
    // repayable total. The ledger below and the "Loan space left" card have to
    // speak the same language, or the officer adds up two different answers to
    // one question.
    const loanBasisIsGoods = cycle?.exh_loan_cap_include_interest === false
    const loanItems = exhibitionOrders.filter((o) => o.payment_option === 'Loan')
    const goodsByOrder = new Map()
    if (loanBasisIsGoods && loanItems.length) {
      const { data: lines } = await supabase
        .from('exhibition_order_lines')
        .select('order_id, amount')
        .in('order_id', loanItems.map((o) => Number(o.id)))
      for (const line of lines || []) {
        const key = Number(line.order_id)
        goodsByOrder.set(key, (goodsByOrder.get(key) || 0) + Number(line.amount || 0))
      }
    }
    // Falls back to the total when an order has no lines, exactly as the
    // exposure function does, so the two cannot disagree about an old order.
    const loanBasisOf = (o) => {
      const total = Number(o.total_amount || 0)
      if (!loanBasisIsGoods) return total
      const key = Number(o.id)
      return goodsByOrder.has(key) ? goodsByOrder.get(key) : total
    }

    // ── Day-by-day ledger ────────────────────────────────────────────
    const byDay = new Map()
    for (const o of exhibitionOrders) {
      const key = dayKey(o.created_at)
      const cur = byDay.get(key) || { date: key, orders: [], total: 0, savings: 0, loan: 0 }
      const amount = Number(o.total_amount || 0)
      const loanBasis = o.payment_option === 'Loan' ? loanBasisOf(o) : 0
      cur.orders.push({
        order_id: o.order_id || `#${o.id}`,
        status: o.status || '',
        amount,
        loan_basis: loanBasis,
        payment_option: o.payment_option || '',
        created_at: o.created_at || null,
      })
      cur.total += amount
      if (o.payment_option === 'Loan') cur.loan += loanBasis
      else if (o.payment_option === 'Savings') cur.savings += amount
      byDay.set(key, cur)
    }

    const days = [...byDay.values()]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((d, index) => ({
        day: index + 1,
        date: d.date,
        date_label: dayLabel(d.date),
        orders: d.orders.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))),
        order_count: d.orders.length,
        total: d.total,
        savings: d.savings,
        loan: d.loan,
      }))

    // ── Totals ───────────────────────────────────────────────────────
    const sumBy = (rows, pick) => rows.reduce((sum, r) => sum + (pick(r) || 0), 0)

    const foodTotal = sumBy(foodOrders, (r) => Number(r.total_amount || 0))
    const foodSavings = sumBy(foodOrders.filter((r) => r.payment_option === 'Savings'), (r) => Number(r.total_amount || 0))
    const foodLoan = sumBy(foodOrders.filter((r) => r.payment_option === 'Loan'), (r) => Number(r.total_amount || 0))

    const exhibitionTotal = sumBy(exhibitionOrders, (r) => Number(r.total_amount || 0))
    const exhibitionSavings = sumBy(exhibitionOrders.filter((r) => r.payment_option === 'Savings'), (r) => Number(r.total_amount || 0))
    const exhibitionLoan = sumBy(exhibitionOrders.filter((r) => r.payment_option === 'Loan'), (r) => Number(r.total_amount || 0))

    const savings = Number(member.savings || 0)
    const savingsSpent = foodSavings + exhibitionSavings

    // Remaining loan room comes from the same function checkout enforces. A
    // closed/not-yet-open season simply reports nothing available.
    let loanSpaceLeft = null
    let loanSpaceUsed = 0
    let loanSpaceWarning = ''
    // The composition of that number, as the function itself describes it.
    let loanSpaceParts = null
    if (cycle?.id) {
      try {
        const { data: exposure, error } = await supabase.rpc('check_exhibition_exposure_atomic', {
          p_member_id: memberId,
          p_payment_option: 'Loan',
          p_total_amount: 0,
          p_cycle_id: Number(cycle.id),
        })
        if (error) loanSpaceWarning = error.message || ''
        else if (exposure?.ok) {
          loanSpaceLeft = Number(exposure.loanEligible || 0)
          // Everything already lent against this member: loans on file plus
          // this season's food and exhibition loan orders.
          loanSpaceUsed = Number(exposure.outstandingLoansTotal || 0)
          // Returned by the function that computed the room, not rebuilt here:
          // one rule, one author.
          loanSpaceParts = Array.isArray(exposure.loanSpaceParts) ? exposure.loanSpaceParts : null
        } else loanSpaceWarning = exposure?.error || ''
      } catch (e) {
        loanSpaceWarning = e.message || ''
      }
    }

    return NextResponse.json({
      ok: true,
      member: {
        member_id: member.member_id,
        full_name: member.full_name || '',
        phone: member.phone || '',
        grade: member.grade || '',
        category: member.category || '',
        savings,
        loans: Number(member.loans || 0),
        global_limit: Number(member.global_limit || 0),
        branch_name: member.branches?.name || '',
        branch_code: member.branches?.code || '',
      },
      cycle: cycle
        ? {
            id: Number(cycle.id),
            name: cycle.name || '',
            code: cycle.code || '',
            status: cycle.status || '',
            starts_at: cycle.starts_at || null,
            ends_at: cycle.ends_at || null,
          }
        : null,
      summary: {
        savings,
        five_x_savings: savings * 5,
        grade: member.grade || '',
        global_limit: Number(member.global_limit || 0),
        loan_balance: Number(member.loans || 0),
        food_order_count: foodOrders.length,
        food_total: foodTotal,
        food_savings: foodSavings,
        food_loan: foodLoan,
        food_cycle_name: foodCycle?.name || '',
        exhibition_order_count: exhibitionOrders.length,
        exhibition_total: exhibitionTotal,
        exhibition_savings: exhibitionSavings,
        exhibition_loan: exhibitionLoan,
        // Which figure the day ledger's Loan line is measured on, so the screen
        // can say "goods" only when that is what the season enforces.
        loan_basis_is_goods: loanBasisIsGoods,
        shopping_days: days.length,
        total_shopped: foodTotal + exhibitionTotal,
        savings_spent: savingsSpent,
        savings_balance: savings - savingsSpent,
        loan_space_left: loanSpaceLeft,
        loan_space_parts: loanSpaceParts,
        loan_space_warning: loanSpaceWarning,
      },
      days,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to check member' }, { status: 500 })
  }
}
