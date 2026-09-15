// app/api/members/eligibility/route.js
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCrossModuleExposure } from '@/lib/crossModuleExposure'

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
      .select('member_id,savings,loans,global_limit,category')
      .eq('member_id', memberId)
      .single()
    if (mErr || !m) {
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

    // Loan eligibility: determined entirely by the admin-configured cycle loan
    // cap (per member category).  No hardcoded facility or overall cap — the
    // cycle settings on the admin Data page are the sole source of truth.
    let loanEligible = 0

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
          const memberCategory = String(m?.category || '').toLowerCase()
          const group = memberCategory.includes('pension')
            ? 'pensioner' : memberCategory.includes('retire')
              ? 'retiree' : 'active'

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

          // Cumulative loan amount already in this cycle (Pending/Posted/Delivered)
          if (hasCycleIdCol && cycleLoanCap > 0) {
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

    // Apply cycle cap: the member cannot borrow more than the cycle ceiling minus what they already have.
    let cycleLoanRemaining = null
    if (cycleLoanCap != null && cycleLoanCap > 0) {
      cycleLoanRemaining = Math.max(0, cycleLoanCap - cycleLoanUsed)
      loanEligible = cycleLoanRemaining
    }

    return NextResponse.json({
      ok: true,
      eligibility: {
        savingsEligible,
        loanEligible,
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
