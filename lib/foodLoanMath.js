// lib/foodLoanMath.js
// Facility (grace) pool arithmetic shared by /api/orders,
// /api/members/eligibility — and mirrored by create_food_order_atomic (SQL).
//
// Policy (2026-10-27, replacing the once-per-cycle "Facility has already
// been used" guard):
//   The facility is a per-cycle pool (graceCap) for members whose savings
//   no longer support borrowing (baseEligible = 0). While savings still
//   support the loan (baseEligible > 0) the base already nets out this
//   cycle's usage through cross-module exposure, so the pool rides flat.
//   Once base hits 0 the pool IS the member's remaining room, so it
//   decrements by the loan orders already taken this cycle. Several orders
//   are allowed while they are still inside the pool; exceeding it is
//   caught by the amount check with the real remaining figure.
export function facilityAvailable({ baseEligible, graceCap, cycleLoanUsed }) {
  const grace = Number(graceCap || 0)
  if (!(grace > 0)) return 0
  if (Number(baseEligible || 0) > 0) return grace
  return Math.max(0, grace - Number(cycleLoanUsed || 0))
}
