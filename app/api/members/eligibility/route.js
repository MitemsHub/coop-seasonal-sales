// app/api/members/eligibility/route.js
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCrossModuleExposure } from '@/lib/crossModuleExposure'
import { facilityAvailable } from '@/lib/foodLoanMath'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, serviceKey)

async function hasColumn(table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const memberId = (searchParams.get('member_id') || searchParams.get('id') || '').trim()
    if (!memberId) {
      return NextResponse.json({ ok: false, error: 'member_id or id required' }, { status: 400 })
    }

    let interestRatePct = 13
    let includeInterestInCap = true
    let activeCycleId = null
    try {
      const cyclesHasInclude = await hasColumn('cycles', 'food_loan_cap_include_interest').catch(() => false)
      const select = cyclesHasInclude ? 'id,food_loan_interest_rate_pct,food_loan_cap_include_interest' : 'id,food_loan_interest_rate_pct'
      const { data: cRow, error: cErr } = await supabase.from('cycles').select(select).eq('is_active', true).maybeSingle()
      if (!cErr && cRow) {
        activeCycleId = cRow.id
        if (cRow.food_loan_interest_rate_pct != null) {
          interestRatePct = Math.max(0, Number(cRow.food_loan_interest_rate_pct || 0))
        }
        if (cyclesHasInclude) {
          includeInterestInCap = cRow.food_loan_cap_include_interest !== false
        }
      }
    } catch {}
    const interestRate = Math.max(0, Number(interestRatePct || 0)) / 100

    // 1) Member snapshot (core balances + category for cycle cap lookup)
    const { data: m, error: mErr } = await supabase
      .from('members')
      .select('member_id,savings,loans,global_limit,category,portal_enabled')
      .eq('member_id', memberId)
      .single()
    if (mErr || !m || m.portal_enabled === false) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })
    }

    // 2) Cross-module exposure: Food + Exhibition + RAM orders in the current year
    const { loanExposure, savingsExposure } = await getCrossModuleExposure(supabase, memberId)

    // 3) Compute limits (exposure-aware)
    const savings = Number(m.savings || 0)
    const loans = Number(m.loans || 0)
    const globalLimit = Number(m.global_limit || 0)

    const outstandingLoansTotal = loans + loanExposure
    
    // Savings follows original rule (50% of savings) and does NOT include facility
    const savingsBase = 0.5 * savings
    const savingsEligible = outstandingLoansTotal > 0 ? 0 : Math.max(0, savingsBase - savingsExposure)

    // ── Member group from the category code ───────────────────────────
    // Categories are the single-letter codes: A = Active, P = Pensioner,
    // R = Retiree (E = Exhibition?).  Keep includes() fallbacks so any
    // legacy full-word category ("Pensioner", "Retirey") still resolves.
    const memberCategory = String(m?.category || '').toLowerCase()
    const group = memberCategory === 'p' || memberCategory.includes('pension')
      ? 'pensioner' : memberCategory === 'r' || memberCategory.includes('retire')
        ? 'retiree' : 'active'

    // Loan eligibility: compute base from savings, then cap at admin limit.
    // baseEligible = how much the member CAN borrow based on their savings.
    // The admin-configured cycle cap is the CEILING — the member cannot
    // exceed it, but can borrow less if their savings don't support more.
    // RETIREE RULE: retirees (category R) may borrow at most their savings
    // balance — never 5× — mirroring the RAM module and the atomic SQL fn.
    const rawLoanLimit = group === 'retiree' ? savings : savings * 5
    const effectiveLimit = globalLimit > 0 ? Math.min(rawLoanLimit, globalLimit) : rawLoanLimit
    const baseEligible = Math.max(0, effectiveLimit - outstandingLoansTotal)
    let loanEligible = 0  // will be set after cycle cap is read

    // ── Cycle-level food loan cap enforcement ──────────────────────────
    // The admin-configured per-category cycle cap is the hard ceiling for
    // how much a member can borrow via Loan in a single cycle.  When the
    // cap is set, loanEligible is further reduced to never exceed the
    // remaining cycle capacity (cap minus what the member already has in
    // Pending/Posted/Delivered loan orders this cycle).
    let cycleLoanCap = null       // the admin-set per-category cap (null = no cap set)
    let cycleLoanUsed = 0         // cumulative loan total this cycle
    let graceLoanCap = 0          // grace (non-eligible) cycle cap
    try {
      const cyclesHasPolicy = await hasColumn('cycles', 'food_loan_eligible_amount_cap').catch(() => false)
      if (cyclesHasPolicy && activeCycleId) {
        const cyclesHasPolicyV2 = await hasColumn('cycles', 'food_loan_eligible_amount_cap_pensioner').catch(() => false)
        const hasCycleIdCol = await hasColumn('orders', 'cycle_id').catch(() => false)

        const selectCols = cyclesHasPolicyV2
          ? 'id,food_loan_eligible_amount_cap,food_loan_grace_amount_cap,food_loan_eligible_amount_cap_pensioner,food_loan_eligible_amount_cap_retiree,food_loan_eligible_amount_cap_active,food_loan_grace_amount_cap_pensioner,food_loan_grace_amount_cap_retiree,food_loan_grace_amount_cap_active'
          : 'id,food_loan_eligible_amount_cap,food_loan_grace_amount_cap'
        const { data: policyRow } = await supabase
          .from('cycles')
          .select(selectCols)
          .eq('id', activeCycleId)
          .maybeSingle()

        if (policyRow) {
          // `group` was resolved from the category code above.
          const eligibleFallback = Math.max(0, Math.trunc(Number(policyRow.food_loan_eligible_amount_cap || 0)))
          const graceFallback = Math.max(0, Math.trunc(Number(policyRow.food_loan_grace_amount_cap || 0)))

          if (cyclesHasPolicyV2) {
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
            cycleLoanCap = (eligibleByGroup[group] || 0) > 0 ? eligibleByGroup[group] : eligibleFallback
            graceLoanCap = (graceByGroup[group] || 0) > 0 ? graceByGroup[group] : graceFallback
          } else {
            cycleLoanCap = eligibleFallback
            graceLoanCap = graceFallback
          }

          // Cumulative loan amount already in this cycle (Pending/Posted/Delivered).
          // Also fetched when only a facility cap is configured: the facility
          // pool decrements with this cycle's loan orders for base = 0 members.
          if (hasCycleIdCol && (cycleLoanCap > 0 || graceLoanCap > 0)) {
            const statuses = ['Pending', 'Posted', 'Delivered']
            const { data: cycleRows } = await supabase
              .from('orders')
              .select('total_amount')
              .eq('member_id', memberId)
              .eq('payment_option', 'Loan')
              .eq('cycle_id', activeCycleId)
              .in('status', statuses)
            cycleLoanUsed = (cycleRows || []).reduce((s, r) => s + Number(r.total_amount || 0), 0)
          }
        }
      }
    } catch {}

    // Apply cycle cap as ceiling.
    // The facility (graceLoanCap) is ADDED to the savings-based eligibility
    // for eligible members — it's a universal pool, not just for non-eligible.
    // The admin-set eligible cap is the absolute ceiling.
    //
    // totalBorrowable = baseEligible + facility (savings-based + grace pool)
    // ceiling          = eligibleCap - cycleLoanUsed (admin cap minus what they've used)
    // loanEligible     = min(totalBorrowable, ceiling)
    let cycleLoanRemaining = null
    // Facility pool: flat while base > 0 (base already nets out cycle usage
    // through exposure), decrements from base = 0 — the amount-based rule
    // that replaced the once-per-cycle "Facility has already been used"
    // guard. Mirrors create_food_order_atomic and lib/foodLoanMath.js.
    const facility = facilityAvailable({ baseEligible, graceCap: graceLoanCap, cycleLoanUsed })
    if (cycleLoanCap != null && cycleLoanCap > 0) {
      cycleLoanRemaining = Math.max(0, cycleLoanCap - cycleLoanUsed)
      const totalBorrowable = baseEligible + facility
      loanEligible = Math.min(totalBorrowable, cycleLoanRemaining)
    } else {
      // No cycle cap configured — member gets their full base + facility
      loanEligible = baseEligible + facility
    }

    return NextResponse.json({
      ok: true,
      eligibility: {
        savingsEligible,
        loanEligible,
        baseEligible,  // savings×5 - outstanding (before cycle cap)
        outstandingLoansTotal,
        savingsExposure,
        loanExposure,
        include_interest_in_cap: includeInterestInCap,
        interest_rate: interestRate,
        interest_rate_pct: interestRatePct,
        // Cycle-level food loan cap info (for UI display)
        cycleLoanCap,
        cycleLoanUsed,
        cycleLoanRemaining,
        graceLoanCap,
        group,
        retireeRule: group === 'retiree',
      },
      memberSnapshot: {
        savings,
        loans,
        globalLimit,
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}
