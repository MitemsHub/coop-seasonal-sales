import { describe, expect, it } from 'vitest'
import { buildLoanRoomTimeline } from './exhibitionLoanRoom'

// Real figures for A25862 (DARING KELVINPUPLAT), 2026 exhibition season:
// savings 1,298,440.98, loans 6,596,965.19, global limit 6,700,000, grade
// Senior Clerk → Junior pool 700,000. Savings × 5 is already below the loans,
// so the season's room is the grade pool: 700,000 − 586,988 shopped = 113,012.
const orders = [
  { id: 20, total_amount: 654500, created_at: '2026-11-25T23:00:00Z' },
  { id: 21, total_amount: 44016, created_at: '2026-11-25T23:02:00Z' },
]
const principalByOrder = new Map([
  [20, 550000],
  [21, 36988],
])

describe('buildLoanRoomTimeline', () => {
  it('rebuilds the facility and decrements it order by order', () => {
    const timeline = buildLoanRoomTimeline({
      orders,
      includeInterest: false,
      principalByOrder,
      roomNow: 113012,
    })
    // season_used is everything up to that order; season_total is the season.
    expect(timeline.get(20)).toEqual({ amount: 550000, season_used: 550000, season_total: 586988, facility: 700000, before: 700000, after: 150000 })
    expect(timeline.get(21)).toEqual({ amount: 36988, season_used: 586988, season_total: 586988, facility: 700000, before: 150000, after: 113012 })
  })

  it('uses the repayable total when the cycle counts interest', () => {
    const timeline = buildLoanRoomTimeline({
      orders,
      includeInterest: true,
      principalByOrder,
      roomNow: 0,
    })
    expect(timeline.get(20).amount).toBe(654500)
    expect(timeline.get(21).season_used).toBe(698516)
  })

  it('falls back to the stored total for an order with no readable lines', () => {
    const timeline = buildLoanRoomTimeline({
      orders: [{ id: 7, total_amount: 50000, created_at: '2026-11-01T00:00:00Z' }],
      includeInterest: false,
      principalByOrder: new Map(),
      roomNow: 20000,
    })
    expect(timeline.get(7)).toEqual({ amount: 50000, season_used: 50000, season_total: 50000, facility: 70000, before: 70000, after: 20000 })
  })

  it('orders the timeline by creation time, not by id', () => {
    const timeline = buildLoanRoomTimeline({
      orders: [
        { id: 2, total_amount: 100, created_at: '2026-11-02T00:00:00Z' },
        { id: 1, total_amount: 400, created_at: '2026-11-01T00:00:00Z' },
      ],
      includeInterest: true,
      roomNow: 500,
    })
    expect(timeline.get(1).after).toBe(600)
    expect(timeline.get(2).after).toBe(500)
  })

  it('never reports a negative room', () => {
    const timeline = buildLoanRoomTimeline({
      orders: [{ id: 1, total_amount: 900, created_at: '2026-11-01T00:00:00Z' }],
      includeInterest: true,
      roomNow: 0,
    })
    expect(timeline.get(1).before).toBe(900)
    expect(timeline.get(1).after).toBe(0)
  })
})
