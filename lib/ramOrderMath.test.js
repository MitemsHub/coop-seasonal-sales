// lib/ramOrderMath.test.js
// Unit tests for the Ram shop's sticky order bar math and Place Order gating.
// The helper is the exact source the shop page renders (app/ram/shop/page.jsx
// destructures computeRamOrderState), so these cover:
//   1. qty change → sticky-bar stats update (Rams / Total incl. interest / Max)
//   2. the Place Order disabled logic (reason string + canPlaceOrder boolean)
import { describe, it, expect } from 'vitest'
import { computeRamOrderState } from './ramOrderMath'

// A fully-valid order setup: member has a phone, shop is open, Cash payment
// with a location selected. Everything is derived from the same eligibility
// payload shape the /api/ram/eligibility route returns.
const base = {
  safeQty: 2,
  paymentOption: 'Cash',
  deliveryLocationId: '1',
  shoppingOpen: true,
  submitting: false,
  unitPrice: 400000,
  interestRate: 0.05,
  eligibility: {
    pricing: { unit_price: 400000 },
    financial: { savings: 200000, loans: 0 },
    eligibility: {
      savingsEligible: 1000000,
      loanEligible: 1500000,
      maxRamsAllowedForLoan: 5,
      maxRamsAllowedForSavings: 3,
      remainingLoanQtyThisCycle: 5,
      usedLoanQtyThisCycle: 0,
      loanGraceQty: 1,
      outstandingLoansTotal: 0,
    },
    member: { grade: 'Supervisor', is_retiree: false, is_pensioner: false },
  },
  member: { phone: '08012345678', savings: 200000, loans: 0, global_limit: 0 },
}

describe('ram sticky bar — qty change updates stats', () => {
  it('shows the selected ram count for each qty', () => {
    expect(computeRamOrderState({ ...base, safeQty: 0 }).qty).toBe(0)
    expect(computeRamOrderState({ ...base, safeQty: 1 }).qty).toBe(1)
    expect(computeRamOrderState({ ...base, safeQty: 4 }).qty).toBe(4)
  })

  it('recomputes principal, interest and total when qty changes (Cash — no interest)', () => {
    const s1 = computeRamOrderState({ ...base, paymentOption: 'Cash', safeQty: 1 })
    const s2 = computeRamOrderState({ ...base, paymentOption: 'Cash', safeQty: 3 })

    expect(s1.principal).toBe(400000)
    expect(s1.interest).toBe(0)
    expect(s1.total).toBe(400000)

    expect(s2.principal).toBe(1200000)
    expect(s2.interest).toBe(0)
    expect(s2.total).toBe(1200000)
  })

  it('adds loan interest to the total for Loan payment', () => {
    const s = computeRamOrderState({ ...base, paymentOption: 'Loan', safeQty: 2 })
    // principal 800,000 × 5% = 40,000 interest → total 840,000
    expect(s.principal).toBe(800000)
    expect(s.interest).toBe(40000)
    expect(s.total).toBe(840000)
  })

  it('updates the Max cell per payment option', () => {
    const cash = computeRamOrderState({ ...base, paymentOption: 'Cash' })
    const savings = computeRamOrderState({ ...base, paymentOption: 'Savings' })
    const loan = computeRamOrderState({ ...base, paymentOption: 'Loan' })

    // Cash has no cap; Savings uses the savings cap, Loan the loan cap.
    expect(cash.maxRamsAllowed).toBe(5) // falls back to the loan-or-savings cap
    expect(savings.maxRamsAllowed).toBe(3)
    expect(loan.maxRamsAllowed).toBe(5)
  })

  it('flags qtyExceeded once qty passes the cap (drives the red Max cell + disabled state)', () => {
    // savingsEligible is raised so only the cap (not savings) gates the order
    const highSavings = { ...base.eligibility, eligibility: { ...base.eligibility.eligibility, savingsEligible: 2000000 } }
    const under = computeRamOrderState({ ...base, eligibility: highSavings, paymentOption: 'Savings', safeQty: 3 })
    const over = computeRamOrderState({ ...base, eligibility: highSavings, paymentOption: 'Savings', safeQty: 4 })

    expect(under.qtyExceeded).toBe(false)
    expect(under.canPlaceOrder).toBe(true)
    expect(over.qtyExceeded).toBe(true)
    expect(over.canPlaceOrder).toBe(false)
    expect(over.placeOrderDisabledReason).toBe('Max for Savings: 3 ram(s).')
  })
})

describe('ram Place Order disabled logic', () => {
  it('is enabled for a fully valid order', () => {
    const s = computeRamOrderState(base)
    expect(s.placeOrderDisabledReason).toBeNull()
    expect(s.canPlaceOrder).toBe(true)
  })

  it('disables when ram shopping is closed', () => {
    const s = computeRamOrderState({ ...base, shoppingOpen: false })
    expect(s.placeOrderDisabledReason).toBe('Ram shopping is currently closed.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables while submitting', () => {
    const s = computeRamOrderState({ ...base, submitting: true })
    expect(s.placeOrderDisabledReason).toBe('Submitting your order…')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables until the unit price resolves', () => {
    const s = computeRamOrderState({ ...base, unitPrice: 0, eligibility: { ...base.eligibility, pricing: { unit_price: 0 } } })
    expect(s.placeOrderDisabledReason).toBe('Unit price is not available yet. Please wait a moment and try again.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables when the member has no phone number', () => {
    const s = computeRamOrderState({ ...base, member: { ...base.member, phone: '' } })
    expect(s.placeOrderDisabledReason).toBe('Add your phone number before placing an order.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables until a payment option is selected', () => {
    const s = computeRamOrderState({ ...base, paymentOption: '' })
    expect(s.placeOrderDisabledReason).toBe('Select a payment option to continue.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables until a delivery location is selected', () => {
    const s = computeRamOrderState({ ...base, deliveryLocationId: '' })
    expect(s.placeOrderDisabledReason).toBe('Select a delivery location to continue.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables Loan when the cycle loan quantity is exhausted', () => {
    const s = computeRamOrderState({
      ...base,
      paymentOption: 'Loan',
      eligibility: { ...base.eligibility, eligibility: { ...base.eligibility.eligibility, remainingLoanQtyThisCycle: 0 } },
    })
    expect(s.placeOrderDisabledReason).toBe('You have reached your loan quantity limit for this cycle.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables when qty is zero', () => {
    const s = computeRamOrderState({ ...base, safeQty: 0 })
    expect(s.placeOrderDisabledReason).toBe('Select a quantity greater than 0.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables Savings when the total exceeds savings eligibility', () => {
    const s = computeRamOrderState({
      ...base,
      paymentOption: 'Savings',
      safeQty: 3,
      eligibility: { ...base.eligibility, eligibility: { ...base.eligibility.eligibility, savingsEligible: 100000 } },
    })
    expect(s.placeOrderDisabledReason).toBe('Your total exceeds your available savings eligibility.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('disables Loan when principal exceeds loan eligibility', () => {
    const s = computeRamOrderState({
      ...base,
      paymentOption: 'Loan',
      safeQty: 2,
      eligibility: { ...base.eligibility, eligibility: { ...base.eligibility.eligibility, loanEligible: 500000 } },
    })
    expect(s.placeOrderDisabledReason).toBe('Your principal exceeds your loan eligibility.')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('tells the member how much savings to add to qualify for a loan', () => {
    const s = computeRamOrderState({
      ...base,
      paymentOption: 'Loan',
      safeQty: 2,
      eligibility: {
        ...base.eligibility,
        financial: { ...base.eligibility.financial, savings: 0 },
        eligibility: { ...base.eligibility.eligibility, loanEligible: 500000 },
      },
      member: { ...base.member, savings: 0 },
    })
    // required savings = ceil(principal / 5) = ceil(800,000 / 5) = 160,000
    expect(s.savingsIncreaseNeeded).toBe(160000)
    expect(s.placeOrderDisabledReason).toContain('Increase savings by ₦160,000')
    expect(s.canPlaceOrder).toBe(false)
  })

  it('allows a Loan within the grace window despite low eligibility', () => {
    const s = computeRamOrderState({
      ...base,
      paymentOption: 'Loan',
      safeQty: 1,
      eligibility: {
        ...base.eligibility,
        eligibility: {
          ...base.eligibility.eligibility,
          loanEligible: 100000, // below the 400,000 unit price
          loanGraceQty: 1, // one-ram grace window
          remainingLoanQtyThisCycle: 1,
          usedLoanQtyThisCycle: 0,
        },
      },
    })
    expect(s.allowLoanGrace).toBe(true)
    expect(s.placeOrderDisabledReason).toBeNull()
    expect(s.canPlaceOrder).toBe(true)
  })

  it('keeps disabled reasons consistent with canPlaceOrder across mixed states', () => {
    // Closed shop beats everything else; even a fully-filled form stays locked.
    const s = computeRamOrderState({
      ...base,
      shoppingOpen: false,
      safeQty: 2,
      paymentOption: 'Loan',
      deliveryLocationId: '1',
    })
    expect(s.placeOrderDisabledReason).toBe('Ram shopping is currently closed.')
    expect(s.canPlaceOrder).toBe(false)
  })
})
