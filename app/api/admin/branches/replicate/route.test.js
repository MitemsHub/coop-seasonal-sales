// Unit tests for the "Copy items from another branch" admin API (vitest).
// Verifies: unauthorized gets 401, dry-run writes nothing, full run creates a
// submission and copies entries + missing prices, existing target prices WIN
// (branch independence after copy), and repeat calls are idempotent.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/cache', () => ({ invalidateCache: vi.fn() }))
vi.mock('@/lib/validation', () => ({
  validateSession: vi.fn(async (req) => (req.__admin ? { valid: true, claims: { role: 'admin' } } : { valid: false })),
}))

import { POST } from './route'
import { createClient } from '@/lib/supabaseServer'
import { invalidateCache } from '@/lib/cache'

// Stub shaped to the route's exact call chain. Every filter (eq/or/in/ilike)
// is recorded so awaited queries can be answered with per-filter canned data.
function buildSupabase(state) {
  const s = state
  s.insertedSubs = []
  s.insertedEntries = []
  s.insertedPrices = []
  s.phoneUpdates = []
  s.queries = []

  const makeBuilder = (table) => {
    const f = { table, eqs: [], ors: [], ins: [], ilikes: [] }
    // (builder per query)
    s.queries.push(f)
    const api = {
      select: () => api,
      eq: (col, val) => { f.eqs.push([col, val]); return api },
      or: (clause) => { f.ors.push(clause); return api },
      in: (col, vals) => { f.ins.push([col, vals]); return api },
      range: () => api,
      order: () => api,
      limit: () => api,
      ilike: (clause) => { f.ilikes.push(clause); return api },
      maybeSingle: async () => answerMaybeSingle(f),
      then: (resolve, reject) => resolve(answerList(f)),
    }
    return api
  }

  // eq value helpers
  const eqVal = (f, col) => (f.eqs.find((e) => e[0] === col) || [])[1]
  const hasEq = (f, col, val) => f.eqs.some((e) => e[0] === col && e[1] === val)

  const answerMaybeSingle = (f) => {
    switch (f.table) {
      case 'cycles':
        return { data: { id: 3 }, error: null }
      case 'food_survey_submissions': {
        // branch_id = source (5) → the source's own submission
        if (hasEq(f, 'branch_id', 5)) return { data: s.subs?.[0] ?? null, error: null }
        // branch_id = target (7) → existing replicated sub at the target
        if (f.eqs.some((e) => e[0] === 'branch_id')) return { data: s.existingSub ?? null, error: null }
        return { data: null, error: null }
      }
      case 'branch_item_prices': {
        // target-price lookup hit by item_id filter (already scoped to target+cycle)
        const itemId = eqVal(f, 'item_id')
        const price = s.targetPrices?.[String(itemId)]
        return { data: price != null ? { price } : null, error: null }
      }
      default:
        return { data: null, error: null }
    }
  }

  const answerList = (f) => {
    switch (f.table) {
      case 'branches':
        return { data: s.branches ?? [], error: null }
      case 'cycles':
        return { data: s.cycles ?? [], error: null }
      case 'food_survey_submissions':
        // awaited as a list only for the source's own submission
        return { data: s.subs ?? [], error: null }
      case 'food_survey_entries': {
        // awaited as a list twice with different submission_id:
        //   • submission_id = 100 → the SOURCE's entries
        //   • anything else → target's dupes check
        const sid = eqVal(f, 'submission_id')
        if (sid === 100) return { data: s.entries ?? [], error: null }
        return { data: (s.dupes || []).map((n) => ({ item_name: n })), error: null }
      }
      case 'branch_item_prices': {
        // awaited as a list for the SOURCE branch's prices (paged)
        const b = eqVal(f, 'branch_id')
        if (b === 5) {
          const ids = (f.ins.find((e) => e[0] === 'item_id') || [])[1] || []
          return { data: (s.prices ?? []).filter((p) => !Array.isArray(ids) || ids.length === 0 || ids.includes(p.item_id)), error: null }
        }
        return { data: [], error: null }
      }
      default:
        return { data: [], error: null }
    }
  }

  s.from = (table) => {    if (table === 'food_survey_submissions') {
      return {
        ...makeBuilder(table),
        insert: (row) => ({
          select: () => ({
            single: async () => { s.insertedSubs.push(row); return { data: { id: 901 }, error: null } },
          }),
        }),
      }
    }
    if (table === 'food_survey_entries') {
      return {
        ...makeBuilder(table),
        insert: async (row) => { s.insertedEntries.push(row); return { data: row, error: null } },
      }
    }
    if (table === 'branch_item_prices') {
      return {
        ...makeBuilder(table),
        insert: async (row) => { s.insertedPrices.push(row); return { data: row, error: null } },
      }
    }
    if (table === 'branches') {
      return {
        ...makeBuilder(table),
        update: (patch) => ({
          eq: async () => { if (patch.rep_phone !== undefined) s.phoneUpdates.push(patch.rep_phone); return { data: null, error: null } },
        }),
      }
    }
    if (table === 'audit_log') {
      return { insert: async () => ({ data: null, error: null }) }
    }
    return makeBuilder(table)
  }
  return s
}

function req(body, admin = true) {
  const r = new NextRequest('http://localhost/api/admin/branches/replicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // NextRequest hides Request cookies; the route reads via validateSession
  // (mocked) and request.json() — nothing else. Just tag the auth flag.
  r.__admin = admin
  return r
}

const BASE = { from_branch_id: 5, to_branch_ids: [7] }
const ENTRIES = [
  { submission_id: 100, catalog_id: 1, item_name: 'Gino Tomatoes Sachet', category: 'Paste', price: 7700, photo_url: 'img.png', saved_item_id: 14, cancelled: false },
  { submission_id: 100, catalog_id: 9, item_name: 'Milo 400G', category: 'Drinks', price: 12000, photo_url: '', saved_item_id: 18, cancelled: false },
]

describe('POST /api/admin/branches/replicate', () => {
  beforeEach(() => { createClient.mockReset(); invalidateCache.mockReset() })

  it('rejects unauthenticated callers with 401', async () => {
    createClient.mockReturnValue(buildSupabase({ branches: [], subs: [], entries: [], prices: [] }))
    const res = await POST(req(BASE, false))
    expect(res.status).toBe(401)
    const j = await res.json()
    expect(j.ok).toBe(false)
  })

  it('validates identifiers (bad source / missing targets → 400)', async () => {
    createClient.mockReturnValue(buildSupabase({ branches: [], subs: [], entries: [], prices: [] }))
    for (const body of [{}, { from_branch_id: 5 }, { from_branch_id: 5, to_branch_ids: [] }]) {
      const res = await POST(req(body))
      expect(res.status).toBe(400)
      const j = await res.json()
      expect(j.ok).toBe(false)
    }
  })

  it('dry-run reports counts and writes nothing', async () => {
    const s = buildSupabase({
      branches: [
        { id: 5, code: 'SRC', name: 'Source Branch', rep_phone: '08011111111' },
        { id: 7, code: 'TGT', name: 'Target Branch', rep_phone: '' },
      ],
      subs: [{ id: 100, rep_name: 'Ngozi A', phone: '08011111111', created_at: '2026-10-15' }],
      entries: ENTRIES,
      prices: [{ branch_id: 5, item_id: 14, cycle_id: 3, price: 7700 }],
      targetPrices: {},
    })
    createClient.mockReturnValue(s)
    const res = await POST(req({ ...BASE, dry_run: true }))
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.dry_run).toBe(true)
    const t = j.results[0]
    expect(t.branch_name).toBe('Target Branch')
    expect(t.entries_copied).toBe(2)
    expect(t.prices_written).toBe(1) // only item 14 is priced at source; item 18 unpriced
    expect(t.prices_unpriced_at_source).toBe(1)
    expect(s.insertedSubs.length).toBe(0)
    expect(s.insertedEntries.length).toBe(0)
    expect(s.insertedPrices.length).toBe(0)
    expect(s.phoneUpdates.length).toBe(0)
    expect(invalidateCache).not.toHaveBeenCalled()
  })

  it('full run creates the submission, copies entries, writes prices, backfills rep_phone', async () => {
    const s = buildSupabase({
      branches: [
        { id: 5, code: 'SRC', name: 'Source Branch', rep_phone: '08011111111' },
        { id: 7, code: 'TGT', name: 'Target Branch', rep_phone: '' },
      ],
      subs: [{ id: 100, rep_name: 'Ngozi A', phone: '08011111111', created_at: '2026-10-15' }],
      entries: ENTRIES,
      prices: [{ branch_id: 5, item_id: 14, cycle_id: 3, price: 7700 }],
      targetPrices: {},
    })
    createClient.mockReturnValue(s)
    const res = await POST(req(BASE))
    const j = await res.json()
    expect(j.ok).toBe(true)
    const t = j.results[0]
    expect(t.ok).toBe(true)
    expect(t.entries_copied).toBe(2)
    expect(t.prices_written).toBe(1)
    expect(t.rep_phone).toBe('08011111111')
    expect(s.insertedSubs.length).toBe(1)
    expect(s.insertedEntries.length).toBe(2)
    expect(s.insertedPrices.length).toBe(1)
    expect(s.phoneUpdates).toEqual(['08011111111'])
    expect(invalidateCache).toHaveBeenCalledTimes(1)
  })

  it('existing target price WINS — the copy never overwrites it', async () => {
    const s = buildSupabase({
      branches: [
        { id: 5, code: 'SRC', name: 'Source Branch', rep_phone: '08011111111' },
        { id: 7, code: 'TGT', name: 'Target Branch', rep_phone: '' },
      ],
      subs: [{ id: 100, rep_name: 'Ngozi A', phone: '08011111111', created_at: '2026-10-15' }],
      entries: ENTRIES,
      prices: [{ branch_id: 5, item_id: 14, cycle_id: 3, price: 7700 }],
      targetPrices: { 14: 9999 },
    })
    createClient.mockReturnValue(s)
    const res = await POST(req(BASE))
    const j = await res.json()
    const t = j.results[0]
    expect(t.prices_kept_existing).toBe(1)
    expect(t.prices_written).toBe(0)
    expect(j.results[0].ok).toBe(true)
    for (const p of s.insertedPrices) expect(p.price).not.toBe(9999) // never overwritten
  })

  it('re-running after a successful copy is idempotent (reuse + skips)', async () => {
    const s = buildSupabase({
      branches: [
        { id: 5, code: 'SRC', name: 'Source Branch', rep_phone: '08011111111' },
        { id: 7, code: 'TGT', name: 'Target Branch', rep_phone: '08011111111' },
      ],
      subs: [{ id: 100, rep_name: 'Ngozi A', phone: '08011111111', created_at: '2026-10-15' }],
      entries: ENTRIES,
      prices: [{ branch_id: 5, item_id: 14, cycle_id: 3, price: 7700 }],
      targetPrices: { 14: 7700 },
      existingSub: { id: 555 },
      dupes: ['Gino Tomatoes Sachet', 'Milo 400G'],
    })
    createClient.mockReturnValue(s)
    const res = await POST(req(BASE))
    const j = await res.json()
    const t = j.results[0]
    expect(t.submission).toBe(555)
    expect(t.entries_copied).toBe(0)
    expect(t.prices_written).toBe(0)
    expect(t.prices_kept_existing).toBe(1)
    expect(s.insertedSubs.length).toBe(0)
    expect(s.insertedEntries.length).toBe(0)
    expect(s.insertedPrices.length).toBe(0)
  })
})
