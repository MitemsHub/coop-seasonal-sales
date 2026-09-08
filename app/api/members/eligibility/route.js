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
    try {
      const cyclesHasInclude = await hasColumn('cycles', 'food_loan_cap_include_interest').catch(() => false)
      const select = cyclesHasInclude ? 'id,food_loan_interest_rate_pct,food_loan_cap_include_interest' : 'id,food_loan_interest_rate_pct'
      const { data: cRow, error: cErr } = await supabase.from('cycles').select(select).eq('is_active', true).maybeSingle()
      if (!cErr && cRow) {
        if (cRow.food_loan_interest_rate_pct != null) {
          interestRatePct = Math.max(0, Number(cRow.food_loan_interest_rate_pct || 0))
        }
        if (cyclesHasInclude) {
          includeInterestInCap = cRow.food_loan_cap_include_interest !== false
        }
      }
    } catch {}
    const interestRate = Math.max(0, Number(interestRatePct || 0)) / 100

    // 1) Member snapshot (core balances)
    const { data: m, error: mErr } = await supabase
      .from('members')
      .select('member_id,savings,loans,global_limit')
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

    // Loan eligibility: base eligibility plus N300,000 facility (only if base > 0), capped at N1,000,000
    const ADDITIONAL_FACILITY = 300000 // ₦300,000 facility (total pool)
    const LOAN_CAP = 1000000 // ₦1,000,000 overall cap
    const rawLoanLimit = savings * 5
    const effectiveLimit = Math.min(rawLoanLimit, globalLimit)
    const baseEligible = Math.max(0, effectiveLimit - outstandingLoansTotal)
    const capRemaining = Math.max(0, LOAN_CAP - loanExposure)
    // Facility behaves like its own pool: remaining facility reduces by existing exposure
    const facilityRemaining = Math.max(0, ADDITIONAL_FACILITY - loanExposure)
    const loanEligible = Math.min(baseEligible + facilityRemaining, capRemaining)

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
        interest_rate_pct: interestRatePct
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
