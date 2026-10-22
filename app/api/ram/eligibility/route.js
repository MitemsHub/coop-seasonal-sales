import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateMemberId } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CATEGORY_PRICES = {
  Junior: 400000,
  Senior: 500000,
  Executive: 600000,
  Undefined: 0,
}

function isValidRamCategory(category) {
  return category === 'Executive' || category === 'Senior' || category === 'Junior'
}

function normalizeGrade(grade) {
  return String(grade || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isRetireeGrade(grade) {
  const g = normalizeGrade(grade)
  if (!g) return false
  return g.includes('retiree')
}

function isPensionerGrade(grade) {
  const g = normalizeGrade(grade)
  if (!g) return false
  return g.includes('pensioner')
}

function fallbackRamCategoryFromGrade(grade) {
  const g = normalizeGrade(grade)
  const executive = new Set([
    'deputy governor',
    'director',
    'deputy director',
    'assistant director',
  ])
  const senior = new Set([
    'principal manager',
    'senior manager',
    'manager',
    'deputy manager',
    'assistant manager',
    'senior supervisor 1',
    'senior supervisor 2',
  ])
  const junior = new Set([
    'supervisor',
    'senior clerk',
    'treasury assistant',
    'clerk',
    'treasury assistant 1',
    'drivers',
    'pensioner',
    'retiree',
    'coop staff',
  ])

  if (executive.has(g)) return 'Executive'
  if (senior.has(g)) return 'Senior'
  if (junior.has(g)) return 'Junior'
  return 'Undefined'
}

async function getRamCategory(supabase, memberGrade) {
  const gradeKey = normalizeGrade(memberGrade)
  if (!gradeKey) return 'Undefined'

  const { data, error } = await supabase
    .from('grade_limits')
    .select('category')
    .ilike('grade', memberGrade)
    .maybeSingle()

  if (error) return fallbackRamCategoryFromGrade(memberGrade)

  const cat = String(data?.category || '').trim()
  if (cat === 'Executive' || cat === 'Senior' || cat === 'Junior') return cat
  return fallbackRamCategoryFromGrade(memberGrade)
}

function sumField(rows, field) {
  const f = String(field || '').trim()
  if (!f) return 0
  return (rows || []).reduce((s, r) => s + Number(r?.[f] || 0), 0)
}

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

async function resolveActiveOrLatestRamCycleId(supabase) {
  const { data: active, error: aErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (aErr) {
    if (!isMissingTable(aErr, 'ram_cycles')) throw aErr
    return null
  }
  if (active?.id) return active.id

  const { data: latest, error: lErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (lErr) {
    if (!isMissingTable(lErr, 'ram_cycles')) throw lErr
    return null
  }
  return latest?.id ?? null
}

function computeMaxAffordableQty({ unitPrice, maxCap, eligibleAmount, includeInterest, interestRate }) {
  const price = Number(unitPrice || 0)
  const eligible = Number(eligibleAmount || 0)
  const cap = Math.max(0, Math.trunc(Number(maxCap || 0)))
  if (!Number.isFinite(price) || price <= 0) return 0
  if (!Number.isFinite(eligible) || eligible <= 0) return 0

  let best = 0
  for (let q = 1; q <= cap; q += 1) {
    const principal = price * q
    const rate = Number.isFinite(Number(interestRate)) ? Number(interestRate) : 0
    const interest = includeInterest ? Math.round(principal * rate) : 0
    const total = principal + interest
    if (total <= eligible) best = q
  }
  return best
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const memberIdRaw = (searchParams.get('member_id') || searchParams.get('id') || '').trim()
    const memberIdRes = validateMemberId(memberIdRaw)
    if (!memberIdRes.isValid) {
      return NextResponse.json({ ok: false, error: memberIdRes.error }, { status: 400 })
    }

    const memberId = memberIdRes.sanitized.toUpperCase()
    const requestedCategoryRaw = String(searchParams.get('ram_category') || '').trim()
    const supabase = createClient()

    const { data: member, error: mErr } = await supabase
      .from('members')
      .select('member_id,full_name,savings,loans,global_limit,grade,portal_enabled')
      .eq('member_id', memberId)
      .single()
    if (mErr || !member || member.portal_enabled === false) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })
    }

    const ramStatuses = ['Pending', 'Approved']
    const [ramLoanExp, ramSavExp] = await Promise.all([
      supabase
        .from('ram_orders')
        .select('principal_amount')
        .eq('member_id', memberId)
        .eq('payment_option', 'Loan')
        .in('status', ramStatuses),
      supabase
        .from('ram_orders')
        .select('principal_amount')
        .eq('member_id', memberId)
        .eq('payment_option', 'Savings')
        .in('status', ramStatuses),
    ])

    const ramOrdersTableMissing =
      isMissingTable(ramLoanExp.error, 'ram_orders') || isMissingTable(ramSavExp.error, 'ram_orders')

    if (!ramOrdersTableMissing) {
      if (ramLoanExp.error) return NextResponse.json({ ok: false, error: ramLoanExp.error.message }, { status: 500 })
      if (ramSavExp.error) return NextResponse.json({ ok: false, error: ramSavExp.error.message }, { status: 500 })
    }

    const loanExposure = ramOrdersTableMissing ? 0 : sumField(ramLoanExp.data, 'principal_amount')
    const savingsExposure = ramOrdersTableMissing ? 0 : sumField(ramSavExp.data, 'principal_amount')

    const savings = Number(member.savings || 0)
    const loans = Number(member.loans || 0)
    const globalLimit = Number(member.global_limit || 0)

    const outstandingLoansTotal = loans + loanExposure

    const savingsBase = 0.5 * savings
    const savingsEligible = outstandingLoansTotal > 0 ? 0 : Math.max(0, savingsBase - savingsExposure)

    const derivedRamCategory = await getRamCategory(supabase, member.grade)
    const requestedCategory = isValidRamCategory(requestedCategoryRaw) ? requestedCategoryRaw : ''
    const ramCategory = requestedCategory || derivedRamCategory
    let unitPrice = CATEGORY_PRICES[ramCategory] ?? CATEGORY_PRICES.Undefined

    const isRetiree = isRetireeGrade(member.grade)
    const isPensioner = isPensionerGrade(member.grade)
    let exceededLoanLimit = false
    let loanEligible = 0
    const baseLimit = isRetiree ? savings : savings * 5
    const effectiveLimit = globalLimit > 0 ? Math.min(baseLimit, globalLimit) : baseLimit
    if (isRetiree) {
      loanEligible = Math.max(0, effectiveLimit - outstandingLoansTotal)
      exceededLoanLimit = loanEligible <= 0
    } else if (isPensioner) {
      loanEligible = Math.max(0, effectiveLimit - outstandingLoansTotal)
      exceededLoanLimit = loanEligible <= 0
    } else {
      loanEligible = Math.max(0, effectiveLimit - outstandingLoansTotal)
      exceededLoanLimit = loanEligible <= 0
    }

    let activeRamCycleId = null
    let usedLoanQtyThisCycle = 0
    const cyclesHasLoanRate = await hasColumn(supabase, 'ram_cycles', 'loan_interest_rate_pct')
    let loanInterestRatePct = cyclesHasLoanRate ? 0 : 6
    if (!ramOrdersTableMissing) {
      const ordersHasCycle = await hasColumn(supabase, 'ram_orders', 'ram_cycle_id')

      if (ordersHasCycle) {
        try {
          activeRamCycleId = await resolveActiveOrLatestRamCycleId(supabase)
        } catch (e) {
          return NextResponse.json({ ok: false, error: e?.message || 'Failed to resolve ram cycle' }, { status: 500 })
        }
      }

      if (cyclesHasLoanRate && activeRamCycleId != null) {
        const { data: rateRow, error: rErr } = await supabase
          .from('ram_cycles')
          .select('loan_interest_rate_pct')
          .eq('id', activeRamCycleId)
          .maybeSingle()
        if (rErr) return NextResponse.json({ ok: false, error: rErr.message }, { status: 500 })
        loanInterestRatePct = Math.max(0, Number(rateRow?.loan_interest_rate_pct || 0))
      }

      const cyclesHasPrices = await hasColumn(supabase, 'ram_cycles', 'price_junior')
      if (cyclesHasPrices && activeRamCycleId != null) {
        const { data: cycleRow, error: pErr } = await supabase
          .from('ram_cycles')
          .select('price_junior, price_senior, price_executive, price_undefined')
          .eq('id', activeRamCycleId)
          .maybeSingle()
        if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })
        const prices = {
          Junior: Number(cycleRow?.price_junior ?? CATEGORY_PRICES.Junior),
          Senior: Number(cycleRow?.price_senior ?? CATEGORY_PRICES.Senior),
          Executive: Number(cycleRow?.price_executive ?? CATEGORY_PRICES.Executive),
          Undefined: Number(cycleRow?.price_undefined ?? CATEGORY_PRICES.Undefined),
        }
        unitPrice = Number.isFinite(prices[ramCategory]) ? Math.max(0, Math.trunc(prices[ramCategory])) : CATEGORY_PRICES.Undefined
      }

      let loanQtyQ = supabase
        .from('ram_orders')
        .select('qty')
        .eq('member_id', memberId)
        .eq('payment_option', 'Loan')
        .in('status', ramStatuses)

      if (ordersHasCycle && activeRamCycleId != null) loanQtyQ = loanQtyQ.eq('ram_cycle_id', activeRamCycleId)

      const { data: loanQtyRows, error: loanQtyErr } = await loanQtyQ
      if (loanQtyErr) return NextResponse.json({ ok: false, error: loanQtyErr.message }, { status: 500 })
      usedLoanQtyThisCycle = sumField(loanQtyRows, 'qty')
    }
    let eligibleP = 1
    let eligibleR = 2
    let eligibleA = 2
    let graceP = 1
    let graceR = 0
    let graceA = 1

    const cyclesHasExplicit = await hasColumn(supabase, 'ram_cycles', 'eligible_loan_qty_active')
    if (cyclesHasExplicit && activeRamCycleId != null) {
      const { data: cycleRow, error: cErr } = await supabase
        .from('ram_cycles')
        .select(
          'eligible_loan_qty_pensioner, eligible_loan_qty_retiree, eligible_loan_qty_active, grace_loan_qty_pensioner, grace_loan_qty_retiree, grace_loan_qty_active'
        )
        .eq('id', activeRamCycleId)
        .maybeSingle()
      if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 })
      eligibleP = Math.max(0, Math.trunc(Number(cycleRow?.eligible_loan_qty_pensioner ?? eligibleP)))
      eligibleR = Math.max(0, Math.trunc(Number(cycleRow?.eligible_loan_qty_retiree ?? eligibleR)))
      eligibleA = Math.max(0, Math.trunc(Number(cycleRow?.eligible_loan_qty_active ?? eligibleA)))
      graceP = Math.max(0, Math.trunc(Number(cycleRow?.grace_loan_qty_pensioner ?? graceP)))
      graceR = Math.max(0, Math.trunc(Number(cycleRow?.grace_loan_qty_retiree ?? graceR)))
      graceA = Math.max(0, Math.trunc(Number(cycleRow?.grace_loan_qty_active ?? graceA)))
    } else {
      let loanQtyCapPensioner = 1
      let loanQtyCapOther = 2
      let loanGraceQty = 1
      const cyclesHasPolicy = await hasColumn(supabase, 'ram_cycles', 'loan_qty_cap_pensioner')
      if (cyclesHasPolicy && activeRamCycleId != null) {
        const { data: cycleRow, error: cErr } = await supabase
          .from('ram_cycles')
          .select('loan_qty_cap_pensioner, loan_qty_cap_other, loan_grace_qty')
          .eq('id', activeRamCycleId)
          .maybeSingle()
        if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 })
        loanQtyCapPensioner = Math.max(0, Math.trunc(Number(cycleRow?.loan_qty_cap_pensioner ?? loanQtyCapPensioner)))
        loanQtyCapOther = Math.max(0, Math.trunc(Number(cycleRow?.loan_qty_cap_other ?? loanQtyCapOther)))
        loanGraceQty = Math.max(0, Math.trunc(Number(cycleRow?.loan_grace_qty ?? loanGraceQty)))
      }
      eligibleP = loanQtyCapPensioner
      eligibleR = loanQtyCapOther
      eligibleA = loanQtyCapOther
      graceP = loanGraceQty
      graceR = 0
      graceA = loanGraceQty
    }

    const loanQtyCap = isPensioner ? eligibleP : isRetiree ? eligibleR : eligibleA
    const graceQty = isPensioner ? graceP : isRetiree ? graceR : graceA
    const effectiveGraceQty = Math.min(graceQty, loanQtyCap)
    const remainingLoanQtyThisCycle = Math.max(0, loanQtyCap - usedLoanQtyThisCycle)

    const loanPolicyCapPrincipal = unitPrice > 0 ? unitPrice * loanQtyCap : 0
    if (loanPolicyCapPrincipal > 0) {
      loanEligible = Math.min(loanEligible, loanPolicyCapPrincipal)
      exceededLoanLimit = loanEligible <= 0
    }

    let maxRamsAllowedForLoan = 0
    if (remainingLoanQtyThisCycle > 0 && unitPrice > 0) {
      const graceUnused = usedLoanQtyThisCycle <= 0
      if (loanEligible < unitPrice) {
        maxRamsAllowedForLoan = graceUnused ? Math.min(effectiveGraceQty, remainingLoanQtyThisCycle) : 0
      } else if (loanEligible > 0) {
        const cap = Math.min(loanQtyCap, remainingLoanQtyThisCycle)
        maxRamsAllowedForLoan = computeMaxAffordableQty({
          unitPrice,
          maxCap: cap,
          eligibleAmount: loanEligible,
          includeInterest: false,
          interestRate: loanInterestRatePct / 100,
        })
      }
      maxRamsAllowedForLoan = Math.min(maxRamsAllowedForLoan, remainingLoanQtyThisCycle)
    }
    const maxCapSavings = unitPrice > 0 ? Math.min(1000, Math.max(0, Math.trunc(savingsEligible / unitPrice))) : 0
    const maxRamsAllowedForSavings = computeMaxAffordableQty({
      unitPrice,
      maxCap: maxCapSavings,
      eligibleAmount: savingsEligible,
      includeInterest: false,
      interestRate: loanInterestRatePct / 100,
    })
    const maxRamsAllowedForLoanOrSavings = Math.max(maxRamsAllowedForLoan, maxRamsAllowedForSavings)

    return NextResponse.json({
      ok: true,
      member: {
        member_id: member.member_id,
        full_name: member.full_name,
        grade: member.grade || '',
        ram_category: ramCategory,
        derived_ram_category: derivedRamCategory,
        is_retiree: isRetiree,
        is_pensioner: isPensioner,
      },
      financial: {
        savings,
        loans,
      },
      pricing: {
        unit_price: unitPrice,
      },
      eligibility: {
        savingsEligible,
        loanEligible,
        exceededLoanLimit,
        outstandingLoansTotal,
        savingsExposure,
        loanExposure,
        maxRamsAllowedForLoanOrSavings,
        maxRamsAllowedForLoan,
        maxRamsAllowedForSavings,
        usedLoanQtyThisCycle,
        remainingLoanQtyThisCycle,
        activeRamCycleId,
        ramOrdersTableMissing,
        loanQtyCap,
        loanGraceQty: effectiveGraceQty,
      },
      rules: {
        loan_interest_rate: Math.max(0, Number(loanInterestRatePct || 0)) / 100,
        loan_interest_rate_pct: Math.max(0, Number(loanInterestRatePct || 0)),
        cash_unlimited: true,
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}
