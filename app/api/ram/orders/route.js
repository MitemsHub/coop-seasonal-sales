import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import {
  validateMemberId,
  validateNumber,
  validatePaymentOption,
} from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/ram/orders?member_id=XXX — the member's ram orders, newest first.
// Pass &status_only=1 to fetch just id + status (used by the member's
// status-toast poll so it stays light), mirroring the food/exhibition
// status-only views.
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const memberId = String(searchParams.get('member_id') || '').trim().toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const statusOnly = searchParams.get('status_only') === '1'
    const supabase = createClient()
    const { data: orders, error } = await supabase
      .from('ram_orders')
      .select(
        statusOnly
          ? 'id, status'
          : 'id, member_id, status, created_at, payment_option, qty, unit_price, principal_amount, interest_amount, total_amount, ram_delivery_location_id'
      )
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
    if (error) {
      if (isMissingTable(error, 'ram_orders')) {
        return NextResponse.json({ ok: false, error: 'Ram Sales is not set up yet.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, orders: orders || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load orders' }, { status: 500 })
  }
}

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

async function calculateEligibilityForRam(supabase, memberId, memberSnapshot, unitPrice) {
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
    if (ramLoanExp.error) throw new Error(ramLoanExp.error.message)
    if (ramSavExp.error) throw new Error(ramSavExp.error.message)
  }

  const loanExposure = ramOrdersTableMissing ? 0 : sumField(ramLoanExp.data, 'principal_amount')
  const savingsExposure = ramOrdersTableMissing ? 0 : sumField(ramSavExp.data, 'principal_amount')

  const savings = Number(memberSnapshot.savings || 0)
  const loans = Number(memberSnapshot.loans || 0)
  const globalLimit = Number(memberSnapshot.global_limit || 0)

  const outstandingLoansTotal = loans + loanExposure

  const savingsBase = 0.5 * savings
  const savingsEligible = outstandingLoansTotal > 0 ? 0 : Math.max(0, savingsBase - savingsExposure)

  const isRetiree = isRetireeGrade(memberSnapshot.grade)
  const isPensioner = isPensionerGrade(memberSnapshot.grade)
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
      activeRamCycleId = await resolveActiveOrLatestRamCycleId(supabase)
    }

    if (cyclesHasLoanRate && activeRamCycleId != null) {
      const { data: rateRow, error: rErr } = await supabase
        .from('ram_cycles')
        .select('loan_interest_rate_pct')
        .eq('id', activeRamCycleId)
        .maybeSingle()
      if (rErr) throw new Error(rErr.message)
      loanInterestRatePct = Math.max(0, Number(rateRow?.loan_interest_rate_pct || 0))
    }

    let loanQtyQ = supabase
      .from('ram_orders')
      .select('qty')
      .eq('member_id', memberId)
      .eq('payment_option', 'Loan')
      .in('status', ramStatuses)
    if (ordersHasCycle && activeRamCycleId != null) loanQtyQ = loanQtyQ.eq('ram_cycle_id', activeRamCycleId)
    const { data: loanQtyRows, error: loanQtyErr } = await loanQtyQ
    if (loanQtyErr) throw new Error(loanQtyErr.message)
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
    if (cErr) throw new Error(cErr.message)
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
      if (cErr) throw new Error(cErr.message)
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

  return {
    savingsEligible,
    loanEligible,
    exceededLoanLimit,
    outstandingLoansTotal,
    maxRamsAllowedForLoanOrSavings,
    maxRamsAllowedForLoan,
    maxRamsAllowedForSavings,
    usedLoanQtyThisCycle,
    remainingLoanQtyThisCycle,
    activeRamCycleId,
    ramOrdersTableMissing,
    isRetiree,
    isPensioner,
    loanQtyCap,
    loanGraceQty: effectiveGraceQty,
    loanInterestRatePct,
    loanInterestRate: Math.max(0, Number(loanInterestRatePct || 0)) / 100,
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))

    const memberIdRes = validateMemberId(String(body.member_id || ''))
    if (!memberIdRes.isValid) {
      return NextResponse.json({ ok: false, error: memberIdRes.error }, { status: 400 })
    }

    const paymentRes = validatePaymentOption(String(body.payment_option || ''))
    if (!paymentRes.isValid) {
      return NextResponse.json({ ok: false, error: paymentRes.error }, { status: 400 })
    }

    const qtyRes = validateNumber(body.qty, { min: 1, max: 1000, integer: true })
    if (!qtyRes.isValid) {
      return NextResponse.json({ ok: false, error: qtyRes.error }, { status: 400 })
    }

    const deliveryLocationIdRes = validateNumber(body.delivery_location_id, { min: 1, integer: true })
    if (!deliveryLocationIdRes.isValid) {
      return NextResponse.json({ ok: false, error: 'Delivery location is required' }, { status: 400 })
    }

    const memberId = memberIdRes.sanitized.toUpperCase()
    const paymentOption = paymentRes.sanitized
    const qty = qtyRes.value
    const deliveryLocationId = deliveryLocationIdRes.value
    const requestedCategoryRaw = String(body.ram_category || '').trim()
    const requestedCategory = requestedCategoryRaw ? (isValidRamCategory(requestedCategoryRaw) ? requestedCategoryRaw : null) : ''
    if (requestedCategory === null) {
      return NextResponse.json({ ok: false, error: 'Invalid ram category' }, { status: 400 })
    }

    const supabase = createClient()

    const { data: member, error: mErr } = await supabase
      .from('members')
      .select('member_id,full_name,savings,loans,global_limit,grade,phone')
      .eq('member_id', memberId)
      .single()
    if (mErr || !member) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })
    }

    const memberPhoneDigits = String(member.phone || '').replace(/\D/g, '')
    if (!memberPhoneDigits) {
      return NextResponse.json(
        { ok: false, error: 'Phone number is required. Please update your phone number before placing an order.' },
        { status: 400 }
      )
    }
    if (memberPhoneDigits.length !== 11) {
      return NextResponse.json(
        { ok: false, error: 'Phone number must be exactly 11 digits. Please update your phone number before placing an order.' },
        { status: 400 }
      )
    }

    const derivedRamCategory = await getRamCategory(supabase, member.grade)
    const canOverrideCategory = (paymentOption === 'Cash' || paymentOption === 'Savings') && !!requestedCategory
    const ramCategory = canOverrideCategory ? requestedCategory : derivedRamCategory
    let unitPrice = CATEGORY_PRICES[ramCategory] ?? CATEGORY_PRICES.Undefined
    const cyclesHasPrices = await hasColumn(supabase, 'ram_cycles', 'price_junior')
    if (cyclesHasPrices) {
      const cycleId = await resolveActiveOrLatestRamCycleId(supabase).catch(() => null)
      if (cycleId != null) {
        const { data: cycleRow, error: pErr } = await supabase
          .from('ram_cycles')
          .select('price_junior, price_senior, price_executive, price_undefined')
          .eq('id', cycleId)
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
    }
    if (unitPrice <= 0) {
      return NextResponse.json({ ok: false, error: 'Member is not eligible for ram pricing' }, { status: 400 })
    }

    const eligibility = await calculateEligibilityForRam(supabase, memberId, member, unitPrice)
    const maxAllowed =
      paymentOption === 'Savings' ? eligibility.maxRamsAllowedForSavings : eligibility.maxRamsAllowedForLoan

    const principalAmount = unitPrice * qty

    if (paymentOption === 'Savings') {
      if (eligibility.savingsEligible <= 0) {
        return NextResponse.json({ ok: false, error: 'Savings option not available for this member' }, { status: 400 })
      }
      if (qty > maxAllowed) {
        return NextResponse.json(
          { ok: false, error: `Maximum allowed is ${maxAllowed} ram(s) for Savings` },
          { status: 400 }
        )
      }
    }

    if (paymentOption === 'Loan') {
      const loanCap = Number(eligibility.loanQtyCap || 0)
      if (qty > loanCap) return NextResponse.json({ ok: false, error: `Maximum allowed is ${loanCap} ram(s) for Loan` }, { status: 400 })
      if (eligibility.isRetiree && principalAmount > eligibility.loanEligible) {
        const shortfall = Math.max(0, principalAmount - Number(eligibility.loanEligible || 0))
        return NextResponse.json(
          { ok: false, error: `Your purchase will exceed your loan limit by ₦${Number(shortfall).toLocaleString()}. Increase savings by ₦${Number(shortfall).toLocaleString()} to qualify.` },
          { status: 400 }
        )
      }
      if (qty > maxAllowed) {
        return NextResponse.json(
          { ok: false, error: `Maximum allowed is ${maxAllowed} ram(s) for Loan` },
          { status: 400 }
        )
      }
    }

    const loanRate = Number.isFinite(Number(eligibility.loanInterestRate)) ? Number(eligibility.loanInterestRate) : 0.06
    const interestAmount = paymentOption === 'Loan' ? Math.round(principalAmount * loanRate) : 0
    const totalAmount = principalAmount + interestAmount

    if (paymentOption === 'Savings' && totalAmount > eligibility.savingsEligible) {
      return NextResponse.json({ ok: false, error: 'Insufficient savings eligibility for this purchase' }, { status: 400 })
    }
    if (paymentOption === 'Loan' && principalAmount > eligibility.loanEligible) {
      const graceQty = Number(eligibility.loanGraceQty || 0)
      const allowFallbackOne =
        qty > 0 &&
        qty <= graceQty &&
        eligibility.remainingLoanQtyThisCycle > 0 &&
        eligibility.loanEligible < unitPrice &&
        eligibility.usedLoanQtyThisCycle <= 0
      if (!allowFallbackOne) {
        return NextResponse.json({ ok: false, error: 'Insufficient loan eligibility for this purchase' }, { status: 400 })
      }
    }

    const { data: deliveryLocation, error: locErr } = await supabase
      .from('ram_delivery_locations')
      .select('id,is_active')
      .eq('id', deliveryLocationId)
      .eq('is_active', true)
      .single()
    if (locErr) {
      const tableMissing = isMissingTable(locErr, 'ram_delivery_locations')
      if (tableMissing) {
        return NextResponse.json(
          { ok: false, error: 'Ram delivery locations are not created yet. Run the ram sales migration in Supabase.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: locErr.message }, { status: 500 })
    }
    if (!deliveryLocation) {
      return NextResponse.json({ ok: false, error: 'Delivery location not found' }, { status: 404 })
    }

    if (eligibility.activeRamCycleId != null) {
      const { data: link, error: linkErr } = await supabase
        .from('ram_cycle_delivery_locations')
        .select('id,is_active')
        .eq('ram_cycle_id', eligibility.activeRamCycleId)
        .eq('ram_delivery_location_id', deliveryLocation.id)
        .maybeSingle()
      if (linkErr) {
        if (!isMissingTable(linkErr, 'ram_cycle_delivery_locations')) {
          return NextResponse.json({ ok: false, error: linkErr.message }, { status: 500 })
        }
      } else {
        if (!link?.id || link?.is_active === false) {
          return NextResponse.json({ ok: false, error: 'Delivery location is not available for the current cycle' }, { status: 400 })
        }
      }
    }

    if (eligibility.ramOrdersTableMissing) {
      return NextResponse.json(
        { ok: false, error: 'Ram Sales database tables are not created yet. Run the ram sales migration in Supabase.' },
        { status: 500 }
      )
    }

    const ordersHasCycle = await hasColumn(supabase, 'ram_orders', 'ram_cycle_id')
    let ramCycleId = ordersHasCycle ? eligibility.activeRamCycleId : null

    const createdSince = new Date(Date.now() - 30_000).toISOString()
    let dupeQ = supabase
      .from('ram_orders')
      .select('id')
      .eq('member_id', memberId)
      .eq('payment_option', paymentOption)
      .eq('status', 'Pending')
      .eq('qty', qty)
      .eq('unit_price', unitPrice)
      .eq('ram_delivery_location_id', deliveryLocation.id)
      .gte('created_at', createdSince)
      .order('created_at', { ascending: false })
      .limit(1)
    if (ordersHasCycle && ramCycleId != null) dupeQ = dupeQ.eq('ram_cycle_id', ramCycleId)
    const { data: dupeRows, error: dupeErr } = await dupeQ
    if (dupeErr) return NextResponse.json({ ok: false, error: dupeErr.message }, { status: 500 })
    const dupe = (dupeRows || [])[0]
    if (dupe?.id) {
      return NextResponse.json({ ok: true, order: { id: dupe.id } })
    }

    const { data: inserted, error: insErr } = await supabase
      .from('ram_orders')
      .insert({
        member_id: memberId,
        payment_option: paymentOption,
        status: 'Pending',
        member_grade: member.grade || '',
        member_category: ramCategory,
        unit_price: unitPrice,
        qty,
        principal_amount: principalAmount,
        interest_amount: interestAmount,
        total_amount: totalAmount,
        ram_delivery_location_id: deliveryLocation.id,
        ...(ordersHasCycle && ramCycleId != null ? { ram_cycle_id: ramCycleId } : {})
      })
      .select('id,total_amount,payment_option,qty,member_category,created_at')
      .single()

    if (insErr || !inserted) {
      return NextResponse.json({ ok: false, error: insErr?.message || 'Failed to create order' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, order: inserted })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Unknown error' }, { status: 500 })
  }
}
