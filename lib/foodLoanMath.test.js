import { describe, it, expect } from 'vitest'
import { facilityAvailable } from './foodLoanMath'

// Regression tests for the facility (grace) pool rule that replaced the
// once-per-cycle "Facility has already been used for this member in the
// current cycle." guard — the bug that rejected A22772's second loan order
// while inside their limit. See docs/loan-policy-walkthrough-2026-10-20.md.
describe('facilityAvailable', () => {
  it('returns 0 when no facility cap is configured', () => {
    expect(facilityAvailable({ baseEligible: 100, graceCap: 0, cycleLoanUsed: 0 })).toBe(0)
  })

  it('rides flat while savings still support borrowing (base > 0)', () => {
    // A22772's first-order case: base ₦7,856 with ₦88,822 already used —
    // base already nets out cycle usage through exposure, so pool stays flat.
    expect(facilityAvailable({ baseEligible: 7856, graceCap: 300000, cycleLoanUsed: 88822 })).toBe(300000)
  })

  it('decrements by this cycle\'s loan orders once base hits 0 (A22772 second order)', () => {
    // base 0, pool ₦300,000, ₦153,822 already in loan orders this cycle
    // → ₦146,178 room left, so the ₦65,000 Kings Oil order is allowed.
    expect(facilityAvailable({ baseEligible: 0, graceCap: 300000, cycleLoanUsed: 153822 })).toBe(146178)
  })

  it('floors at 0 — never a negative pool', () => {
    expect(facilityAvailable({ baseEligible: 0, graceCap: 300000, cycleLoanUsed: 300000 })).toBe(0)
    expect(facilityAvailable({ baseEligible: 0, graceCap: 300000, cycleLoanUsed: 400000 })).toBe(0)
  })

  it('tolerates missing / non-numeric inputs', () => {
    expect(facilityAvailable({ baseEligible: 0 })).toBe(0)
    expect(facilityAvailable({ baseEligible: 0, graceCap: 100000, cycleLoanUsed: null })).toBe(100000)
    expect(facilityAvailable({ baseEligible: 0, graceCap: 100000, cycleLoanUsed: undefined })).toBe(100000)
  })
})
