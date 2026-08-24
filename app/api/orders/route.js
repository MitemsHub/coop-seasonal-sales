// app/api/orders/route.js
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, message: 'orders API alive' })
}

export async function POST(req) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabase = createClient(url, serviceKey)

    const hasColumn = async (table, column) => {
      const { error } = await supabase.from(table).select(column).limit(1)
      return !error
    }
    
    const body = await req.json()
    const { memberId, deliveryBranchCode, departmentName, paymentOption, lines } = body || {}

    if (!memberId || !deliveryBranchCode || !departmentName || !paymentOption || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
    }

    const { data: activeCycle, error: cycleErr } = await supabase
      .from('cycles')
      .select('id, starts_at, ends_at')
      .eq('is_active', true)
      .maybeSingle()
    if (cycleErr) return NextResponse.json({ ok: false, error: cycleErr.message }, { status: 500 })
    if (!activeCycle?.id) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    // Reject orders outside the cycle date window
    const now = Date.now()
    if (activeCycle.starts_at && new Date(activeCycle.starts_at).getTime() > now) {
      return NextResponse.json({ ok: false, error: 'This cycle has not started yet. Orders open on ' + new Date(activeCycle.starts_at).toLocaleDateString() }, { status: 400 })
    }
    if (activeCycle.ends_at && new Date(activeCycle.ends_at).getTime() <= now) {
      return NextResponse.json({ ok: false, error: 'This cycle has ended. Please wait for the next cycle to open.' }, { status: 400 })
    }

    const [ordersHasCycle, pricesHasCycle, markupsHasCycle] = await Promise.all([
      hasColumn('orders', 'cycle_id'),
      hasColumn('branch_item_prices', 'cycle_id'),
      hasColumn('branch_item_markups', 'cycle_id'),
    ])

    const cyclesHasFoodPolicy = await hasColumn('cycles', 'food_loan_eligible_amount_cap').catch(() => false)
    const cyclesHasFoodPolicyV2 = await hasColumn('cycles', 'food_loan_eligible_amount_cap_pensioner').catch(() => false)
    const cyclesHasFoodInterestRate = await hasColumn('cycles', 'food_loan_interest_rate_pct').catch(() => false)
    const ordersHasFoodGraceFlag = await hasColumn('orders', 'food_loan_grace_used').catch(() => false)

    // Member (home branch + balances)
    const { data: member, error: mErr } = await supabase
      .from('members')
      .select('member_id, full_name, category, savings, loans, global_limit, branch_id')
      .eq('member_id', memberId)
      .single()
    if (mErr || !member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })

    // Delivery branch (pricing & inventory)
    const { data: deliveryBranch, error: bErr } = await supabase
      .from('branches').select('id, code, name')
      .eq('code', deliveryBranchCode)
      .single()
    if (bErr || !deliveryBranch) return NextResponse.json({ ok: false, error: 'Delivery branch not found' }, { status: 400 })

    // Department
    const { data: deptRow, error: dErr } = await supabase
      .from('departments').select('id, name')
      .eq('name', departmentName).single()
    if (dErr || !deptRow) return NextResponse.json({ ok: false, error: 'Department not found' }, { status: 400 })

    // Exposure (Pending + Posted + Delivered)
    const statuses = ['Pending','Posted','Delivered'];
    const sumAmt = (rows) => (rows || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);

// Loans
    const { data: loanRows, error: le } = await supabase
      .from('orders')
      .select('total_amount')
      .eq('member_id', memberId)
      .eq('payment_option', 'Loan')
      .in('status', statuses);
    if (le) return NextResponse.json({ ok:false, error: le.message }, { status:500 });

// Savings
    const { data: savRows, error: se } = await supabase
      .from('orders')
      .select('total_amount')
      .eq('member_id', memberId)
      .eq('payment_option', 'Savings')
      .in('status', statuses);
    if (se) return NextResponse.json({ ok:false, error: se.message }, { status:500 });

    // Exposure totals from existing orders (these totals already include interest for Loan orders)
    const loanExposureWithInterest = sumAmt(loanRows);
    const savingsExposure = sumAmt(savRows);

    // Cumulative loan amount in THIS cycle for this member (for cycle cap enforcement).
    let cycleLoanTotal = 0
    if (ordersHasCycle && activeCycle?.id) {
      const { data: cycleLoanRows } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('member_id', memberId)
        .eq('payment_option', 'Loan')
        .eq('cycle_id', activeCycle.id)
        .in('status', statuses)
      cycleLoanTotal = sumAmt(cycleLoanRows)
    }

    const memberLoans = Number(member.loans || 0);       // core loans
    const memberSavings = Number(member.savings || 0);
    const globalLimit = Number(member.global_limit || 0);

    // Any outstanding loan (core + exposure) blocks Savings
    const outstandingLoansTotal = memberLoans + loanExposureWithInterest;

    const savingsBase = 0.5 * memberSavings;
    const savingsEligible = outstandingLoansTotal > 0 ? 0 : Math.max(0, savingsBase - savingsExposure);

    // Loan eligibility: base eligibility plus N300,000 facility, capped against remaining of N1,000,000
    const ADDITIONAL_FACILITY = 300000; // ₦300,000 facility (total pool)
    const LOAN_CAP = 1000000;           // ₦1,000,000 overall cap
    const rawLoanLimit = memberSavings * 5 - outstandingLoansTotal;
    const baseEligible = Math.min(Math.max(rawLoanLimit, 0), globalLimit);
    const capRemaining = Math.max(0, LOAN_CAP - loanExposureWithInterest);
    // Facility behaves like its own pool and reduces with current exposure
    const facilityRemaining = Math.max(0, ADDITIONAL_FACILITY - loanExposureWithInterest);
    const loanEligible = Math.min(baseEligible + facilityRemaining, capRemaining);

    // Price lines from DELIVERY branch
    let total = 0
    const pricedLines = []
    for (const l of lines) {
      const sku = l?.sku
      const qty = Number(l?.qty || 0)
      if (!sku || qty <= 0) return NextResponse.json({ ok:false, error:'Invalid line item' }, { status:400 })

      const { data: item, error: iErr } = await supabase.from('items').select('item_id, sku').eq('sku', sku).single()
      if (iErr || !item) return NextResponse.json({ ok:false, error:`Item not found: ${sku}` }, { status:400 })

      let priceQuery = supabase
        .from('branch_item_prices')
        .select('id, price')
        .eq('branch_id', deliveryBranch.id)
        .eq('item_id', item.item_id)
      if (pricesHasCycle) priceQuery = priceQuery.eq('cycle_id', activeCycle.id)

      const { data: bip, error: pErr } = await priceQuery.single()
      if (pErr || !bip) return NextResponse.json({ ok:false, error:`No price for ${sku} in this branch` }, { status:400 })

      // Add branch-specific markup if configured
      let markupAmount = 0
      let mkQuery = supabase
        .from('branch_item_markups')
        .select('amount, active')
        .eq('branch_id', deliveryBranch.id)
        .eq('item_id', item.item_id)
      if (markupsHasCycle) mkQuery = mkQuery.eq('cycle_id', activeCycle.id)
      const { data: mk, error: mkErr } = await mkQuery.single()
      if (!mkErr && mk && mk.active) {
        markupAmount = Number(mk.amount || 0)
      }
      const unit_price = Number(bip.price) + markupAmount
      const amount = unit_price * qty
      total += amount

      pricedLines.push({ item_id: item.item_id, branch_item_price_id: bip.id, unit_price, qty, amount })
    }

    let eligibleLoanMaxCap = 0
    let graceLoanMaxCap = 0
    let includeInterestInCap = true
    let loanRatePct = cyclesHasFoodInterestRate ? 0 : 13
    if (cyclesHasFoodPolicy) {
      const { data: policyRow, error: pErr } = await supabase
        .from('cycles')
        .select(
          cyclesHasFoodPolicyV2
            ? `food_loan_eligible_amount_cap,food_loan_grace_amount_cap,food_loan_eligible_amount_cap_pensioner,food_loan_eligible_amount_cap_retiree,food_loan_eligible_amount_cap_active,food_loan_grace_amount_cap_pensioner,food_loan_grace_amount_cap_retiree,food_loan_grace_amount_cap_active,food_loan_cap_include_interest${cyclesHasFoodInterestRate ? ',food_loan_interest_rate_pct' : ''}`
            : `food_loan_eligible_amount_cap,food_loan_grace_amount_cap${cyclesHasFoodInterestRate ? ',food_loan_interest_rate_pct' : ''}`
        )
        .eq('id', activeCycle.id)
        .maybeSingle()
      if (!pErr && policyRow) {
        if (cyclesHasFoodInterestRate) loanRatePct = Math.max(0, Number(policyRow.food_loan_interest_rate_pct || 0))
        const memberCategory = String(member?.category || '').toLowerCase()
        const group =
          memberCategory.includes('pension') ? 'pensioner' : memberCategory.includes('retire') ? 'retiree' : 'active'

        includeInterestInCap = cyclesHasFoodPolicyV2 ? policyRow.food_loan_cap_include_interest !== false : true

        const eligibleFallback = Math.max(0, Math.trunc(Number(policyRow.food_loan_eligible_amount_cap || 0)))
        const graceFallback = Math.max(0, Math.trunc(Number(policyRow.food_loan_grace_amount_cap || 0)))

        if (cyclesHasFoodPolicyV2) {
          const eligibleByGroup = {
            pensioner: Math.max(0, Math.trunc(Number(policyRow.food_loan_eligible_amount_cap_pensioner || 0))),
            retiree: Math.max(0, Math.trunc(Number(policyRow.food_loan_eligible_amount_cap_retiree || 0))),
            active: Math.max(0, Math.trunc(Number(policyRow.food_loan_eligible_amount_cap_active || 0))),
          }
          const graceByGroup = {
            pensioner: Math.max(0, Math.trunc(Number(policyRow.food_loan_grace_amount_cap_pensioner || 0))),
            retiree: Math.max(0, Math.trunc(Number(policyRow.food_loan_grace_amount_cap_retiree || 0))),
            active: Math.max(0, Math.trunc(Number(policyRow.food_loan_grace_amount_cap_active || 0))),
          }
          eligibleLoanMaxCap = (eligibleByGroup[group] || 0) > 0 ? eligibleByGroup[group] : eligibleFallback
          graceLoanMaxCap = (graceByGroup[group] || 0) > 0 ? graceByGroup[group] : graceFallback
        } else {
          eligibleLoanMaxCap = eligibleFallback
          graceLoanMaxCap = graceFallback
        }
      }
    }

    if (cyclesHasFoodInterestRate && !cyclesHasFoodPolicy) {
      const { data: rRow, error: rErr } = await supabase
        .from('cycles')
        .select('food_loan_interest_rate_pct')
        .eq('id', activeCycle.id)
        .maybeSingle()
      if (!rErr && rRow) loanRatePct = Math.max(0, Number(rRow.food_loan_interest_rate_pct || 0))
    }

    const loanRate = Math.max(0, Number(loanRatePct || 0)) / 100
    const loanInterest = paymentOption === 'Loan' ? Math.round(total * loanRate) : 0
    const totalWithInterest = total + loanInterest

    // Enforce limits
    if (paymentOption === 'Savings') {
      if (outstandingLoansTotal > 0) return NextResponse.json({ ok:false, error:'Savings not allowed while loans outstanding (incl. pending/posted loan apps)' }, { status:400 })
      if (total > savingsEligible)   return NextResponse.json({ ok:false, error:`Total ₦${total.toLocaleString()} exceeds Savings available ₦${savingsEligible.toLocaleString()}` }, { status:400 })
    } else if (paymentOption === 'Loan') {
      const capAmount = includeInterestInCap ? totalWithInterest : total
      const cumulativeCapAmount = cycleLoanTotal + capAmount
      if (eligibleLoanMaxCap > 0 && cumulativeCapAmount > eligibleLoanMaxCap) {
        return NextResponse.json(
          {
            ok: false,
            error: includeInterestInCap
              ? `Eligible max for this cycle is ₦${eligibleLoanMaxCap.toLocaleString()}. You already have ₦${cycleLoanTotal.toLocaleString()} in this cycle; adding ₦${totalWithInterest.toLocaleString()} (incl. ${loanRatePct}% interest) would exceed it.`
              : `Eligible max for this cycle is ₦${eligibleLoanMaxCap.toLocaleString()}. You already have ₦${cycleLoanTotal.toLocaleString()} in this cycle; adding ₦${total.toLocaleString()} would exceed it (interest is excluded from the cap).`,
          },
          { status: 400 }
        )
      }

      const eligibilityCapAmount = includeInterestInCap ? totalWithInterest : total
      if (eligibilityCapAmount > loanEligible) {
        if (graceLoanMaxCap <= 0) {
          return NextResponse.json(
            {
              ok: false,
              error: includeInterestInCap
                ? `Total (incl. ${loanRatePct}% interest) ₦${totalWithInterest.toLocaleString()} exceeds Loan available ₦${loanEligible.toLocaleString()}`
                : `Principal total ₦${total.toLocaleString()} exceeds Loan available ₦${loanEligible.toLocaleString()} (interest is excluded from the cap)`,
            },
            { status: 400 }
          )
        }
        if (cumulativeCapAmount > graceLoanMaxCap) {
          return NextResponse.json(
            {
              ok: false,
              error: includeInterestInCap
                ? `You are currently not eligible for Loan. Grace max for this cycle is ₦${graceLoanMaxCap.toLocaleString()} but you already have ₦${cycleLoanTotal.toLocaleString()} and adding ₦${totalWithInterest.toLocaleString()} (incl. ${loanRatePct}% interest) would exceed it.`
                : `You are currently not eligible for Loan. Grace max for this cycle is ₦${graceLoanMaxCap.toLocaleString()} but you already have ₦${cycleLoanTotal.toLocaleString()} and adding ₦${total.toLocaleString()} would exceed it (interest is excluded from the cap).`,
            },
            { status: 400 }
          )
        }

        if (ordersHasFoodGraceFlag) {
          let gq = supabase
            .from('orders')
            .select('order_id')
            .eq('member_id', memberId)
            .eq('payment_option', 'Loan')
            .eq('food_loan_grace_used', true)
            .in('status', statuses)
            .order('order_id', { ascending: false })
            .limit(1)
          if (ordersHasCycle) gq = gq.eq('cycle_id', activeCycle.id)
          const { data: usedRows, error: gErr } = await gq
          if (!gErr && (usedRows || []).length > 0) {
            return NextResponse.json(
              { ok: false, error: 'Grace has already been used for this member in the current cycle.' },
              { status: 400 }
            )
          }
        }
      }
    } else if (paymentOption !== 'Cash') {
      return NextResponse.json({ ok:false, error:'Invalid payment option' }, { status:400 })
    }

    // Duplicate guard — same member, payment, and total within 30 seconds
    const createdSince = new Date(Date.now() - 30_000).toISOString()
    let dupeQ = supabase
      .from('orders')
      .select('order_id')
      .eq('member_id', memberId)
      .eq('payment_option', paymentOption)
      .eq('status', 'Pending')
      .eq('total_amount', paymentOption === 'Loan' ? totalWithInterest : total)
      .gte('created_at', createdSince)
      .order('created_at', { ascending: false })
      .limit(1)
    if (ordersHasCycle && activeCycle?.id) dupeQ = dupeQ.eq('cycle_id', activeCycle.id)
    const { data: dupeRows } = await dupeQ
    if ((dupeRows || []).length > 0) {
      return NextResponse.json({ ok: true, order_id: dupeRows[0].order_id, duplicate: true })
    }

    // Insert order (home + delivery branches)
    const orderInsert = {
      member_id: member.member_id,
      member_name_snapshot: member.full_name,
      member_category_snapshot: member.category,
      branch_id: member.branch_id,
      delivery_branch_id: deliveryBranch.id,
      department_id: deptRow.id,
      payment_option: paymentOption,
      total_amount: paymentOption === 'Loan' ? totalWithInterest : total,
      status: 'Pending'
    }
    if (ordersHasCycle) orderInsert.cycle_id = activeCycle.id
    if (ordersHasFoodGraceFlag && paymentOption === 'Loan' && (includeInterestInCap ? totalWithInterest : total) > loanEligible && graceLoanMaxCap > 0 && cumulativeCapAmount <= graceLoanMaxCap) {
      orderInsert.food_loan_grace_used = true
    }

    const { data: order, error: oErr } = await supabase
      .from('orders')
      .insert(orderInsert)
      .select('order_id')
      .single()
    if (oErr || !order) return NextResponse.json({ ok:false, error:oErr?.message || 'Insert failed' }, { status:500 })

    const rows = pricedLines.map(pl => ({ order_id: order.order_id, ...pl }))
    const { error: lErr } = await supabase.from('order_lines').insert(rows)
    if (lErr) return NextResponse.json({ ok:false, error:lErr.message }, { status:500 })

    return NextResponse.json({ ok:true, order_id: order.order_id, total: paymentOption === 'Loan' ? totalWithInterest : total, paymentOption, eligibility: { savingsEligible, loanEligible }, interest: loanInterest })
  } catch (e) {
    return NextResponse.json({ ok:false, error:e.message || 'Unknown error' }, { status:500 })
  }
}
