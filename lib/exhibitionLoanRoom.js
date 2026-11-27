// lib/exhibitionLoanRoom.js
// The approvals desk shows a member's loan room next to every order. The RPC
// (check_exhibition_exposure_atomic) only answers "how much is left right now",
// i.e. after every open order the member holds, so a page of several orders
// repeats one number and the room looks frozen — an approver cannot tell what
// this order took, or what was left before it.
//
// This rebuilds the season's arithmetic per order:
//
//   facility = room now + everything counted this season
//   room after an order = facility − everything counted up to and including it
//
// `facility` is the member's season entitlement (savings space plus the grade
// pool, capped by the global limit) and is constant for the season; each order
// then decrements it. Interest is excluded when the cycle's
// exh_loan_cap_include_interest is false, matching the RPC, which measures
// orders by their line amounts in that case — so an order's goods value, not
// its repayable total, is what moves the room.

/**
 * @param {object} args
 * @param {Array<{id:number|string, total_amount:number|string, created_at?:string}>} args.orders
 *   the counted loan orders of one member in one cycle (any order)
 * @param {boolean} [args.includeInterest] cycle's exh_loan_cap_include_interest
 * @param {Map<number, number>} [args.principalByOrder] order id → sum of line amounts
 * @param {number} [args.roomNow] the RPC's loanEligible for this member + cycle
 * @returns {Map<number, {amount:number, season_used:number, season_total:number, facility:number, before:number, after:number}>}
 */
export function buildLoanRoomTimeline({ orders, includeInterest = true, principalByOrder = new Map(), roomNow = 0 }) {
  const counted = (orders || [])
    .map((o) => {
      const lines = principalByOrder.get(Number(o.id))
      const amount = !includeInterest && lines != null ? Number(lines) : Number(o.total_amount || 0)
      return {
        id: Number(o.id),
        amount: Math.max(0, Number(amount) || 0),
        at: String(o.created_at || ''),
      }
    })
    .sort((a, b) => (a.at === b.at ? a.id - b.id : a.at < b.at ? -1 : 1))

  const seasonUsed = counted.reduce((sum, o) => sum + o.amount, 0)
  const facility = Math.max(0, Number(roomNow) || 0) + seasonUsed

  const timeline = new Map()
  let cumulative = 0
  for (const o of counted) {
    cumulative += o.amount
    timeline.set(o.id, {
      amount: o.amount,
      // `season_used` is everything up to and including this order (the before
      // figure); `season_total` is the whole season, which is what the desk
      // reports as "used on loan this season" on every row.
      season_used: cumulative,
      season_total: seasonUsed,
      facility,
      before: Math.max(0, facility - (cumulative - o.amount)),
      after: Math.max(0, facility - cumulative),
    })
  }
  return timeline
}
