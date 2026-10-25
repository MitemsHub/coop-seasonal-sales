// lib/quickAnalysis.test.js
// Unit tests for the Quick Analysis infographic's grouping rules — the model
// that feeds lib/quickAnalysisCanvas.js (the browser port of
// build_infographic.py). The prototype asserted the same partition:
// every branch lands in exactly one group, top 10 first, then mid (5+),
// low (1–4) and zero.
import { describe, it, expect } from 'vitest'
import { buildQuickAnalysisModel } from './quickAnalysis'

const row = (branch_name, pending = 0, posted = 0, delivered = 0) => ({
  branch_name, pending, posted, delivered,
})

// 39 branches shaped like the prototype's dataset: one 24-order leader,
// a couple of ties, a mid tier, a long 1–4 tail and zero-order branches.
const sampleByBranch = [
  row('Head Office', 4, 20),
  row('Jos', 2, 14),
  row('Calabar', 1, 12),
  row('Owerri', 3, 10),
  row('Jalingo', 2, 10),
  row('Coop Secretariat', 0, 10),
  row('Abuja Branch', 1, 8),
  row('Lagos Branch', 2, 7),
  row('Bauchi', 1, 6),
  row('Makurdi', 3, 4),
  row('Enugu', 1, 5),
  row('Awka', 0, 5),
  row('Kaduna', 1, 4),
  row('Umuahia', 2, 3),
  row('Lokoja', 4, 0),
  row('Katsina', 1, 2),
  row('Lafia', 3, 0),
  row('Port-Harcourt', 1, 2),
  row('Yenagoa', 0, 3),
  row('Abakaliki', 1, 1),
  row('Akure', 2, 0),
  row('Benin', 1, 1),
  row('Gombe', 0, 2),
  row('Kano Branch', 1, 1),
  row('Maiduguri', 2, 0),
  row('Asaba', 1, 0),
  row('Ibadan', 0, 1),
  row('Minna', 1, 0),
  row('Oshogbo', 0, 1),
  row('Abeokuta', 0, 0),
  row('Ado-Ekiti', 0, 0),
  row('Birnin-Kebbi', 0, 0),
  row('Damaturu', 0, 0),
  row('Dutse Branch', 0, 0),
  row('Gusau', 0, 0),
  row('Ilorin', 0, 0),
  row('Sokoto', 0, 0),
  row('Uyo', 0, 0),
  row('Yola', 0, 0),
]

describe('buildQuickAnalysisModel', () => {
  it('counts pending + posted + delivered as the branch total, excluding cancelled', () => {
    // Cancelled rows never reach byBranch (the summary filters them out), and
    // any stray non-numeric status column is ignored — only the three
    // operational statuses sum into Orders, matching the Excel the prototype
    // consumed ("the orders column is the total pending and posted orders").
    const model = buildQuickAnalysisModel({
      byBranch: [row('Alpha', 2, 3, 1)],
      allBranches: [],
    })
    expect(model.total).toBe(6)
    expect(model.branchCount).toBe(1)
  })

  it('partitions every branch into exactly one group', () => {
    const m = buildQuickAnalysisModel({ byBranch: sampleByBranch, allBranches: [] })
    const groups = [...m.top, ...m.mid, ...m.low, ...m.zero]
    expect(groups).toHaveLength(m.branchCount)
    const names = groups.map((r) => r.branch_name)
    expect(new Set(names).size).toBe(names.length)
    expect(m.branchCount).toBe(39)
    expect(m.total).toBe(173) // same dataset as the sample infographic
  })

  it('ranks the top 10 with competition ranking (ties share a rank)', () => {
    const m = buildQuickAnalysisModel({ byBranch: sampleByBranch, allBranches: [] })
    expect(m.top.map((r) => r.branch_name)).toEqual([
      'Head Office', 'Jos', 'Calabar', 'Owerri', 'Jalingo',
      'Coop Secretariat', 'Abuja Branch', 'Lagos Branch', 'Bauchi', 'Makurdi',
    ])
    // Calabar(13) and Owerri(13) tie at rank 3 → next is rank 5 (Jalingo)
    expect(m.top.map((r) => r.rank)).toEqual([1, 2, 3, 3, 5, 6, 7, 7, 9, 9])
    expect(m.topSum).toBe(120)
    expect(m.topSharePct).toBeCloseTo((120 / 173) * 100, 5)
    expect(m.maxOrders).toBe(24)
  })

  it('splits the remainder into mid (5+), low (1–4) and zero groups', () => {
    const m = buildQuickAnalysisModel({ byBranch: sampleByBranch, allBranches: [] })
    expect(m.mid.map((r) => r.branch_name)).toEqual(['Enugu', 'Awka', 'Kaduna', 'Umuahia'])
    expect(m.low).toHaveLength(15)
    expect(m.lowSum).toBe(32)
    expect(m.zero.map((r) => r.branch_name)).toEqual([
      'Abeokuta', 'Ado-Ekiti', 'Birnin-Kebbi', 'Damaturu', 'Dutse Branch',
      'Gusau', 'Ilorin', 'Sokoto', 'Uyo', 'Yola',
    ])
  })

  it('adds zero-order branches that are missing from the summary breakdown', () => {
    // The summary views can omit branches with no orders; the master branch
    // list fills them in so the "yet to apply" section stays complete.
    const m = buildQuickAnalysisModel({
      byBranch: [row('Lagos Branch', 1, 1)],
      allBranches: [{ name: 'Lagos Branch' }, { name: 'Jos' }, 'Kano'],
    })
    expect(m.branchCount).toBe(3)
    expect(m.total).toBe(2)
    expect(m.zero.map((r) => r.branch_name)).toEqual(['Jos', 'Kano'])
  })

  it('never spends a top-10 slot on a zero-order branch', () => {
    const m = buildQuickAnalysisModel({
      byBranch: [row('One', 1), row('Two', 0)],
      allBranches: [],
    })
    expect(m.top.map((r) => r.branch_name)).toEqual(['One'])
    expect(m.zero.map((r) => r.branch_name)).toEqual(['Two'])
    expect([...m.top, ...m.mid, ...m.low, ...m.zero]).toHaveLength(2)
  })

  it('sorts by orders desc then branch name for a stable layout', () => {
    const m = buildQuickAnalysisModel({
      byBranch: [row('Zulu', 2), row('Alpha', 2), row('Mike', 5)],
      allBranches: [],
    })
    expect(m.top.map((r) => r.branch_name)).toEqual(['Mike', 'Alpha', 'Zulu'])
  })

  it('returns safe zeros for an empty cycle (no NaN in the KPI row)', () => {
    const m = buildQuickAnalysisModel({ byBranch: [], allBranches: [] })
    expect(m.total).toBe(0)
    expect(m.branchCount).toBe(0)
    expect(m.topSharePct).toBe(0)
    expect(m.maxOrders).toBe(0)
    expect(m.top).toHaveLength(0)
  })

  it('treats negative or non-numeric counts as zero', () => {
    const m = buildQuickAnalysisModel({
      byBranch: [{ branch_name: 'Odd', pending: -3, posted: 'x', delivered: 2.9 }],
      allBranches: [],
    })
    expect(m.total).toBe(2)
  })
})
