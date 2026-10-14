// app/api/admin/items/route.test.js
// Unit tests for the outsourced drafts section of the Items Import API —
// specifically the recovery + repair logic that must prevent drafts of
// DIFFERENT products from resolving to the same saved item (the regression
// where five drafts showed SKU KELLOGGSCOPOPSACHET400G / ₦2,660).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/validation', () => ({ validateSession: vi.fn().mockResolvedValue({ valid: true }) }))
vi.mock('@/lib/directDb', () => ({
  queryDirect: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  transactionalQuery: vi.fn(),
}))

import { GET, POST } from './route'
import { createClient } from '@/lib/supabaseServer'
import { queryDirect } from '@/lib/directDb'

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

const ENTRY = (id, name, branchId, price = 0, savedItemId = null) => ({
  id,
  catalog_id: null,
  item_name: name,
  category: 'Cereals',
  price,
  photo_url: '',
  saved_item_id: savedItemId,
  submission: { cycle_id: 9, rep_name: 'Rep A', branch_id: branchId },
})

// One saved outsourced product (Kellogg's cereal) priced ₦2,660 at branch 1 —
// the exact state from the bug screenshot — plus five legacy drafts at the
// same branch for five DIFFERENT products.
function scenario() {
  const items = [
    { item_id: 1, sku: 'KELLOGGSCOPOPSACHET400G', name: "Kellogg's Coco Pops Sachet 400g", category: 'Cereals', unit: 'Carton', image_url: 'x.png', source: 'outsourced' },
  ]
  const prices = [{ branch_id: 1, item_id: 1, price: 2660 }]
  const entries = [
    ENTRY(11, 'Coco pop', 1, 2500),
    ENTRY(12, 'Cornflakes', 1, 2600),
    ENTRY(13, 'Custard (Checkers)', 1, 2700),
    ENTRY(14, 'Detergent', 1, 2800),
    ENTRY(15, "King's Oil", 1, 2900),
  ]
  return { items, prices, entries }
}

function makeSupabase({ items, prices, entries, markups = [] }) {
  const replies = {
    items: { data: items, error: null },
    branch_item_prices: { data: prices, error: null },
    branch_item_markups: { data: markups, error: null },
    branch_item_markups_probe: { error: null },
    food_survey_entries: { data: entries, error: null },
    food_survey_catalog: { data: [], error: null },
    branches: { data: [{ id: 1, name: 'Abeokuta', code: 'ABEOKUTA' }], error: null },
    cycles: { data: [{ id: 9 }], error: null },
  }
  // hasColumn(table, column) probes select the column directly and expect
  // error===null; our fake answers success for every probe.
  const builder = (table) => {
    const r = () => ({ ...(replies[table] || { data: [], error: null }) })
    return {
      select: () => ({
        ...r(),
        eq: () => ({
          ...r(),
          maybeSingle: () => Promise.resolve(r()),
          range: () => Promise.resolve(r()),
          order: () => ({
            ...r(),
            maybeSingle: () => Promise.resolve(r()),
          }),
        }),
        gt: () => ({ ...r(), eq: () => Promise.resolve(r()) }),
        not: () => builder(table),
        neq: () => builder(table),
        order: () => Promise.resolve(r()),
        in: () => Promise.resolve(r()),
        or: () => Promise.resolve(r()),
        limit: () => Promise.resolve(r()),
      }),
    }
  }
  return { from: builder }
}

const GET_OUTSOURCED = new Request(new URL('http://x/api/admin/items?section=outsourced&cycle_id=9'))

beforeEach(() => {
  queryDirect.mockReset()
  queryDirect.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('POST outsourced save — draft pinning', () => {
  it('pins the survey entry via queryDirect and does NOT crash on scope error (ReferenceError regression)', async () => {
    const items = [
      { item_id: 1, sku: 'KELLOGGSCOPOPSACHET400G', name: "Kellogg's Coco Pops Sachet 400g", category: 'Cereals', unit: 'Carton', image_url: 'x.png', source: 'outsourced' },
    ]
    const priceItemRow = { item_id: 1, sku: 'KELLOGGSCOPOPSACHET400G', name: "Kellogg's Coco Pops Sachet 400g" }
    const supa = {
      from(table) {
        const upsertOk = () => Promise.resolve({ data: null, error: null, count: 1 })
        // covers: branches list/probe, items update, maybeSingle lookups
        return {
          select: () => ({
            order: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: 1, code: 'ABEOKUTA', name: 'Abeokuta' }, error: null }),
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 1, code: 'ABEOKUTA' }, error: null }) }),
            }),
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: 1, code: 'ABEOKUTA' }, error: null }),
              single: () => Promise.resolve({ data: priceItemRow, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: { id: 1, code: 'ABEOKUTA' }, error: null }),
            single: () => Promise.resolve({ data: priceItemRow, error: null }),
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: priceItemRow, error: null }),
              }),
            }),
          }),
          upsert: () => upsertOk(),
        }
      },
    }
    createClient.mockReturnValue(supa)

    const body = {
      section: 'outsourced',
      item_id: 1,
      name: "Kellogg's Coco Pops Sachet 400g",
      sku: 'KELLOGGSCOPOPSACHET400G',
      category: 'Cereals',
      unit: 'Carton',
      price: 2660,
      image_url: 'x.png',
      draft: { branch_id: 1, branch_name: 'Abeokuta', branch_code: 'ABEOKUTA', draft_id: 11, draft_name: 'Coco pop', draft_category: 'Cereals', draft_unit: 'Carton', draft_price: 2500, saved: false, key: 'b1::coco pop' },
    }
    const req = new Request('http://x/api/admin/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    const res = await POST(req)
    const json = await res.json()
    // Before the fix this crashed with 500 “surveyEntryId is not defined”.
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    // The pin step ran with the right ids (entry 11 → item 1).
    expect(queryDirect).toHaveBeenCalledWith(
      expect.stringContaining('SET saved_item_id = $1 WHERE id = $2'),
      [1, 11]
    )
  })
})

describe('outsourced drafts — link recovery and repair', () => {
  it('does NOT force-link drafts of different products to the only priced item at a branch (screenshot regression)', async () => {
    const s = scenario()
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    // Every one of the 5 drafts has a price DIFFERENT from item 1's ₦2,660,
    // so none may be linked to item 1 — they must fall back to the name
    // match (which misses) and show as unsaved (Not worked on yet).
    for (const r of body.rows) {
      if (r.draft) {
        expect(r.item_id).not.toBe(1)
        expect(r.saved).toBe(false)
      }
    }
    // The real product still resolves to its item (name or link path).
    const savedRows = body.rows.filter((r) => !r.draft || r.saved)
    expect(savedRows.length).toBe(1) // the cereal card itself (saved, no draft)
    expect(savedRows[0].item_id).toBe(1)

    // And nothing was persisted against the wrong item.
    expect(queryDirect).not.toHaveBeenCalledWith(expect.stringContaining('SET saved_item_id = $1'), expect.anything())
  })

  it('re-links a legacy draft when its price uniquely matches a priced item at its branch', async () => {
    const s = scenario()
    // Give the "Coco pop" draft the exact branch price of item 1 → the only
    // outsourced item whose branch-1 price equals the draft price.
    s.entries = s.entries.map((e) => (e.id === 11 ? ENTRY(11, 'Coco pop', 1, 2660) : e))
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(body.ok).toBe(true)

    const coco = body.rows.find((r) => r.draft?.draft_name === 'Coco pop')
    expect(coco.saved).toBe(true)
    expect(coco.item_id).toBe(1)
    // The other four drafts stay unlinked (their prices don't match).
    for (const r of body.rows) {
      if (r.draft && r.draft.draft_name !== 'Coco pop') {
        expect(r.saved).toBe(false)
        expect(r.item_id).not.toBe(1)
      }
    }
  })

  it('persists a recovered link via queryDirect with the right ids', async () => {
    const s = scenario()
    s.entries = s.entries.map((e) => (e.id === 12 ? ENTRY(12, 'Cornflakes', 1, 2660) : e))
    createClient.mockReturnValue(makeSupabase(s))

    await GET(GET_OUTSOURCED.clone())
    // Entry 12 legitimately matches item 1's price signature → persisted.
    expect(queryDirect).toHaveBeenCalledWith(
      expect.stringContaining('SET saved_item_id = $1'),
      [1, 12]
    )
  })

  it('clears conflicting persisted links (repair pass) — two different-name drafts pinned to one item', async () => {
    const s = scenario()
    // Legacy DB had wrongly persisted: entry 11 → item 1, entry 12 → item 1.
    s.entries = [
      ENTRY(11, 'Coco pop', 1, 2500, 1),
      ENTRY(12, 'Cornflakes', 1, 2600, 1),
    ]
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Repair must have cleared both wrong links in one persisted update.
    expect(queryDirect).toHaveBeenCalledWith(
      expect.stringContaining('SET saved_item_id = NULL'),
      [[11, 12]]
    )
    // And both drafts resolve as unsaved at runtime (no more force-link).
    for (const r of body.rows) {
      if (r.draft) {
        expect(r.saved).toBe(false)
        expect(r.item_id).not.toBe(1)
      }
    }
  })

  it('KEEPS legit links: same product name re-submitted at a branch is not a conflict', async () => {
    const s = scenario()
    s.entries = [
      ENTRY(21, 'Coco pop', 1, 2660, 1),
      ENTRY(22, 'Coco pop', 1, 2660, 1),
    ]
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(body.ok).toBe(true)
    // Repair pass must not touch same-name groups.
    expect(queryDirect).not.toHaveBeenCalledWith(expect.stringContaining('SET saved_item_id = NULL'), expect.anything())
    for (const r of body.rows) {
      if (r.draft?.draft_name === 'Coco pop') {
        expect(r.saved).toBe(true)
        expect(r.item_id).toBe(1)
      }
    }
  })
})
