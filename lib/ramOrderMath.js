// lib/ramOrderMath.js
// Pure computation for the Ram shop's sticky order bar and Place Order gating.
// Extracted from app/ram/shop/page.jsx so the stats (Rams / Total / Max) and
// the disabled-reason logic can be unit-tested without rendering the shop.
//
// Inputs mirror the page state:
//   safeQty          — the member's selected ram quantity (already truncated)
//   paymentOption    — '' | 'Cash' | 'Savings' | 'Loan'
//   deliveryLocationId — selected ram delivery location id ('' when none)
//   shoppingOpen, submitting, unitPrice, interestRate
//   eligibility      — the /api/ram/eligibility payload
//   member           — the members row (phone, savings, loans, global_limit, grade)

export function computeRamOrderState({
  safeQty,
  paymentOption,
  deliveryLocationId,
  shoppingOpen = true,
  submitting = false,
  unitPrice = 0,
  interestRate = 0,
  eligibility = null,
  member = null,
} = {}) {
  const qty = Number.isFinite(Number(safeQty)) ? Math.trunc(Number(safeQty)) : 0

  const principal = unitPrice * Number(qty || 0)
  const interest = paymentOption === 'Loan' ? Math.round(principal * interestRate) : 0
  const total = principal + interest

  const maxRamsAllowed =
    paymentOption === 'Savings'
      ? Number(eligibility?.eligibility?.maxRamsAllowedForSavings ?? eligibility?.eligibility?.maxRamsAllowedForLoanOrSavings ?? 0)
      : Number(eligibility?.eligibility?.maxRamsAllowedForLoan ?? eligibility?.eligibility?.maxRamsAllowedForLoanOrSavings ?? 0)
  const savingsEligible = Number(eligibility?.eligibility?.savingsEligible || 0)
  const loanEligible = Number(eligibility?.eligibility?.loanEligible || 0)
  const remainingLoanQtyThisCycle = Number(eligibility?.eligibility?.remainingLoanQtyThisCycle || 0)
  const gradeText = String(eligibility?.member?.grade || member?.grade || '').toLowerCase()
  const isRetiree = !!eligibility?.member?.is_retiree || gradeText.includes('retiree')
  const isPensioner = !!eligibility?.member?.is_pensioner || gradeText.includes('pensioner')
  const savingsBalance = Number(eligibility?.financial?.savings ?? member?.savings ?? 0)
  const loansBalance = Number(eligibility?.financial?.loans ?? member?.loans ?? 0)
  const phoneMissing = !String(member?.phone || '').trim()

  const usedLoanQtyThisCycle = Number(eligibility?.eligibility?.usedLoanQtyThisCycle || 0)
  const loanGraceQty = Number(eligibility?.eligibility?.loanGraceQty || 0)
  const allowLoanGrace =
    paymentOption === 'Loan' &&
    qty > 0 &&
    qty <= loanGraceQty &&
    unitPrice > 0 &&
    remainingLoanQtyThisCycle > 0 &&
    maxRamsAllowed >= qty &&
    loanEligible < unitPrice &&
    usedLoanQtyThisCycle <= 0

  const qtyCapApplies = paymentOption === 'Loan' || paymentOption === 'Savings'
  const qtyExceeded = qtyCapApplies && qty > 0 && qty > maxRamsAllowed

  const maxStepperQty = (() => {
    if (!paymentOption) return 100
    if (paymentOption === 'Cash') return 100
    if (paymentOption === 'Savings') return Math.max(100, Math.max(0, Math.trunc(Number(maxRamsAllowed || 0))))
    return Math.max(0, Math.trunc(Number(maxRamsAllowed || 0)))
  })()

  const loanShortfall = (() => {
    if (paymentOption !== 'Loan') return 0
    if (allowLoanGrace) return 0
    if (!Number.isFinite(principal) || principal <= 0) return 0
    return Math.max(0, principal - loanEligible)
  })()

  const savingsIncreaseNeeded = (() => {
    if (paymentOption !== 'Loan') return 0
    if (allowLoanGrace) return 0
    if (!Number.isFinite(principal) || principal <= 0) return 0
    if (principal <= loanEligible) return 0

    const outstandingLoansTotal = Number(eligibility?.eligibility?.outstandingLoansTotal || 0)
    const savingsNow = Number(savingsBalance || 0)
    const globalLimit = Number(member?.global_limit || 0)
    const requiredLimit = principal + outstandingLoansTotal

    if (isRetiree) {
      if (globalLimit > 0 && globalLimit < requiredLimit) return 0
      const requiredSavings = requiredLimit
      return Math.max(0, requiredSavings - savingsNow)
    }

    if (globalLimit > 0 && globalLimit < requiredLimit) return 0
    const requiredSavings = Math.ceil(requiredLimit / 5)
    return Math.max(0, requiredSavings - savingsNow)
  })()

  const minLoanSavingsIncreaseNeeded = (() => {
    if (paymentOption !== 'Loan') return 0
    if (allowLoanGrace) return 0
    if (maxRamsAllowed > 0) return 0
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return 0
    if (!Number.isFinite(loanEligible) || loanEligible <= 0) return 0
    if (unitPrice <= loanEligible) return 0

    const outstandingLoansTotal = Number(eligibility?.eligibility?.outstandingLoansTotal || 0)
    const savingsNow = Number(savingsBalance || 0)
    const globalLimit = Number(member?.global_limit || 0)
    const requiredLimit = unitPrice + outstandingLoansTotal

    if (isRetiree) {
      if (globalLimit > 0 && globalLimit < requiredLimit) return 0
      const requiredSavings = requiredLimit
      return Math.max(0, requiredSavings - savingsNow)
    }

    if (globalLimit > 0 && globalLimit < requiredLimit) return 0
    const requiredSavings = Math.ceil(requiredLimit / 5)
    return Math.max(0, requiredSavings - savingsNow)
  })()

  const notEligibleForPayment =
    paymentOption === 'Savings'
      ? total > savingsEligible
      : paymentOption === 'Loan'
        ? principal > loanEligible && !allowLoanGrace
        : false

  const placeOrderDisabledReason = (() => {
    if (!shoppingOpen) return 'Ram shopping is currently closed.'
    if (submitting) return 'Submitting your order…'
    if (unitPrice <= 0) return 'Unit price is not available yet. Please wait a moment and try again.'
    if (phoneMissing) return 'Add your phone number before placing an order.'
    if (!paymentOption) return 'Select a payment option to continue.'
    if (!deliveryLocationId) return 'Select a delivery location to continue.'
    if (paymentOption === 'Loan' && remainingLoanQtyThisCycle <= 0) return 'You have reached your loan quantity limit for this cycle.'
    if (qty <= 0) return 'Select a quantity greater than 0.'
    if (paymentOption !== 'Cash' && qtyCapApplies && maxRamsAllowed > 0 && qty > maxRamsAllowed) {
      return `Max for ${paymentOption}: ${maxRamsAllowed} ram(s).`
    }
    if (paymentOption === 'Loan' && allowLoanGrace) return null
    if (paymentOption === 'Savings' && notEligibleForPayment) return 'Your total exceeds your available savings eligibility.'
    if (paymentOption === 'Loan' && savingsIncreaseNeeded > 0) {
      return `Increase savings by ₦${Number(savingsIncreaseNeeded).toLocaleString()} to qualify for this loan purchase.`
    }
    if (paymentOption === 'Loan' && qty <= 0 && maxRamsAllowed <= 0 && minLoanSavingsIncreaseNeeded > 0) {
      return `Increase savings by ₦${Number(minLoanSavingsIncreaseNeeded).toLocaleString()} to qualify for a 1-ram loan purchase.`
    }
    if (paymentOption === 'Loan' && notEligibleForPayment) return 'Your principal exceeds your loan eligibility.'
    return null
  })()

  // Mirrors the buttons' disabled expression in the shop, plus the loan
  // quantity gate the warning box already surfaces — the Place Order button
  // must never stay enabled while the reason panel says the order can't go
  // through.
  const canPlaceOrder =
    shoppingOpen &&
    !submitting &&
    unitPrice > 0 &&
    !phoneMissing &&
    !!paymentOption &&
    !!deliveryLocationId &&
    qty > 0 &&
    !qtyExceeded &&
    !(paymentOption === 'Loan' && remainingLoanQtyThisCycle <= 0) &&
    !notEligibleForPayment

  return {
    qty,
    principal,
    interest,
    total,
    maxRamsAllowed,
    savingsEligible,
    loanEligible,
    remainingLoanQtyThisCycle,
    isRetiree,
    isPensioner,
    savingsBalance,
    loansBalance,
    phoneMissing,
    allowLoanGrace,
    qtyCapApplies,
    qtyExceeded,
    maxStepperQty,
    loanShortfall,
    savingsIncreaseNeeded,
    minLoanSavingsIncreaseNeeded,
    notEligibleForPayment,
    placeOrderDisabledReason,
    canPlaceOrder,
  }
}
