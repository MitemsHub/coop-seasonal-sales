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

function makeSupabase({ items, prices, entries, markups = [], branches } = {}) {
  const replies = {
    items: { data: items, error: null },
    branch_item_prices: { data: prices, error: null },
    branch_item_markups: { data: markups, error: null },
    branch_item_markups_probe: { error: null },
    food_survey_entries: { data: entries, error: null },
    food_survey_catalog: { data: [], error: null },
    branches: { data: branches || [{ id: 1, name: 'Abeokuta', code: 'ABEOKUTA' }], error: null },
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

  it('Links a name-contained draft but NOT its different-priced-name twin (Ado Rice/Bow Oil regression)', async () => {
    const s = scenario()
    s.items = [
      { item_id: 300, sku: 'BELLALUNARICE50KG', name: 'Bella Luna Rice 50Kg', category: 'Staples', unit: 'Bag', image_url: 'x.png', source: 'outsourced' },
    ]
    s.prices = [{ branch_id: 1, item_id: 300, price: 60000 }]
    // The exact production collision: two different products, SAME price.
    s.entries = [
      ENTRY(11, 'Rice', 1, 60000), // genuinely the Bella Luna product (legacy draft name)
      ENTRY(12, 'Bow Oil', 1, 60000), // an entirely different product
    ]
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(body.ok).toBe(true)

    // "Rice" is name-contained in "Bella Luna Rice 50Kg" → recovered link.
    const rice = body.rows.find((r) => r.draft?.draft_name === 'Rice')
    expect(rice.saved).toBe(true)
    expect(rice.item_id).toBe(300)
    expect(queryDirect).toHaveBeenCalledWith(
      expect.stringContaining('SET saved_item_id = $1'),
      [300, 11]
    )

    // "Bow Oil" shares the price but shares no name → price alone must NOT
    // claim the item; it stays an unsaved card of its own.
    const bow = body.rows.find((r) => r.draft?.draft_name === 'Bow Oil')
    expect(bow.saved).toBe(false)
    expect(bow.item_id).not.toBe(300)
    // And Bow Oil never persistently claimed it either.
    expect(queryDirect).not.toHaveBeenCalledWith(
      expect.stringContaining('SET saved_item_id = $1'),
      [300, 12]
    )
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
})

// Regression: after the admin REFACTORS a draft name into a refined shop name
// ("Coco pop" → "Kellogg's Coco Pops Sachet 400g"), the item must stay in its
// OWN branch group (recovered via saved_item_id) and must NOT show a second
// unconditional copy in the trailing "Saved items — no survey draft" group —
// which sorted last and made the list jump to the final page after every save.
describe('outsourced rows — renamed item has no duplicate trailing row', () => {
  it('links a renamed item to its draft AND does not emit a draft:null duplicate', async () => {
    const s = scenario()
    // Legacy link already persisted: "Coco pop" draft → Kellogg's item 1.
    s.entries = [ENTRY(11, 'Coco pop', 1, 2660, 1)]
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    const draftRow = body.rows.find((r) => r.draft?.draft_name === 'Coco pop')
    expect(draftRow).toBeDefined()
    expect(draftRow.saved).toBe(true)
    expect(draftRow.item_id).toBe(1)
    expect(draftRow.name).toBe("Kellogg's Coco Pops Sachet 400g")

    // The renamed item must appear EXACTLY ONCE — the trailing kept-items
    // pass (draft: null) must not re-add it just because its refined name
    // no longer matches any draft name.
    const kelloggRows = body.rows.filter((r) => r.item_id === 1)
    expect(kelloggRows.length).toBe(1)
    expect(kelloggRows[0].draft).toBe(draftRow.draft)
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

// Regression (2026-10-15, Abeokuta): the admin refined Samvita into "Golden
// Penny Semovita 1Kg" — an item ALREADY saved earlier from Kano's Samvita
// draft. The cycle-wide claim set then hid Abeokuta's card entirely (item
// visible only via Kano + shop preview). One saved item legitimately serves
// MANY branches, each with its own branch price — claims must be scoped to
// (item, branch), and every branch's draft keeps its own card.
describe('outsourced rows — one item claimed from two branches', () => {
  it('does not hide an item claimed from a DIFFERENT branch (Samvita→Semovita regression)', async () => {
    const s = scenario()
    s.items = [
      { item_id: 1, sku: 'GPSEMOVITA1KG', name: 'Golden Penny Semovita 1Kg', category: 'Staples', unit: 'Bag', image_url: 'x.png', source: 'outsourced' },
    ]
    s.prices = [
      { branch_id: 1, item_id: 1, price: 20500 },
      { branch_id: 2, item_id: 1, price: 16600 },
    ]
    s.branches = [
      { id: 1, name: 'Abeokuta', code: 'ABEOKUTA' },
      { id: 2, name: 'Kano Branch', code: 'KANO' },
    ]
    // Production state: Kano's Samvita draft (#132) points at item 1 long
    // ago; Abeokuta's Samvita draft (#509) was then refined and saved to the
    // SAME bank item. The cycle-wide claim set hid Abeokuta's card entirely
    // (item only visible via Kano + shop preview).
    s.entries = [
      ENTRY(132, 'Samvita', 2, 16600, 1), // Kano Branch — claims item 1
      ENTRY(509, 'Samvita', 1, 20500, 1), // Abeokuta — same item, own branch price
    ]
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(body.ok).toBe(true)

    const semovitaRows = body.rows.filter((r) => r.name?.includes('Golden Penny Semovita 1Kg'))
    expect(semovitaRows.length).toBe(2) // one card per branch
    expect(semovitaRows.map((r) => r.draft?.branch_name).sort()).toEqual(['Abeokuta', 'Kano Branch'])
    // And no trailing draft:null copy.
    expect(body.rows.filter((r) => !r.draft).length).toBe(0)
  })
})

describe('outsourced rows — two same-name drafts at one branch stay separate', () => {
  it('keeps a linked draft row even when another draft with the same name was seen first', async () => {
    const s = scenario()
    s.items = [
      { item_id: 1, sku: 'INDOMITABLESNOODLES', name: 'Indomitable Noodles', category: 'Noodles', unit: 'Carton', image_url: 'x.png', source: 'outsourced' },
      { item_id: 2, sku: 'SUPERPACKNOODLES', name: 'Super Pack Noodles', category: 'Noodles', unit: 'Carton', image_url: 'x.png', source: 'outsourced' },
    ]
    s.prices = [
      { branch_id: 1, item_id: 1, price: 9900 },
      { branch_id: 1, item_id: 2, price: 15580 },
    ]
    s.entries = [
      ENTRY(279, 'Noodles', 1, 15580, 2), // Super Pack — seen first
      ENTRY(512, 'Noodles', 1, 9900, 1), // Indomitable — same name, same branch
    ]
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)

    // BOTH products resolve to their own saved row via their links.
    const byName = Object.fromEntries(body.rows.filter((r) => r.saved).map((r) => [r.name, r]))
    expect(Object.keys(byName).sort()).toEqual(['Indomitable Noodles', 'Super Pack Noodles'])
    expect(byName['Indomitable Noodles'].item_id).toBe(1)
    expect(byName['Indomitable Noodles'].draft?.entry_id).toBe(512)
    expect(byName['Super Pack Noodles'].item_id).toBe(2)
    expect(byName['Super Pack Noodles'].draft?.entry_id).toBe(279)

    // And neither lands in the trailing "Saved items — no survey draft"
    // group (draft: null rows) — that is exactly the last-page jump.
    expect(body.rows.filter((r) => !r.draft).length).toBe(0)
  })

  it('collapses a same-product resubmission but keeps a DIFFERENT product visible', async () => {
    const s = scenario()
    s.entries = [
      ENTRY(11, 'Coco pop', 1, 2660, 1), // linked (saved)
      ENTRY(99, 'Coco pop', 1, 2660), // same product resubmitted (price signature matches item 1)
      ENTRY(199, 'Coco pop', 1, 2700), // genuinely different product (different price)
    ]
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(body.ok).toBe(true)

    const cocoRows = body.rows.filter((r) => r.draft?.draft_name === 'Coco pop')
    // The resubmission collapses onto the saved card (one card per product);
    // the differently-priced entry is a different product and stays visible.
    expect(cocoRows.length).toBe(2)
    const linked = cocoRows.find((r) => r.saved)
    expect(linked.item_id).toBe(1)
    const distinct = cocoRows.find((r) => !r.saved)
    expect(distinct.draft.entry_id).toBe(199)
    expect(distinct.draft.draft_price).toBe(2700)
    // And neither may appear a SECOND time in the trailing draft:null group.
    expect(body.rows.filter((r) => !r.draft).length).toBe(0)
  })

  it('SHows both same-name rice drafts at one branch when they are different products (Abeokuta regression)', async () => {
    const s = scenario()
    s.items = [
      { item_id: 1, sku: 'BULMEXRICE50KG', name: 'Bulmex Rice 50Kg', category: 'Staples', unit: 'Bag', image_url: 'x.png', source: 'outsourced' },
    ]
    s.prices = [{ branch_id: 1, item_id: 1, price: 51000 }]
    // The exact production state: entry #274 (linked to Bulmex) came after
    // entry #505 (an UNlinked second "Rice" — a different product).
    s.entries = [
      ENTRY(505, 'Rice', 1, 52000), // first entry, no link yet
      ENTRY(274, 'Rice', 1, 51000, 1), // second, saved as Bulmex Rice
    ]
    createClient.mockReturnValue(makeSupabase(s))

    const res = await GET(GET_OUTSOURCED.clone())
    const body = await res.json()
    expect(body.ok).toBe(true)

    const riceRows = body.rows.filter((r) => r.draft?.draft_name === 'Rice')
    expect(riceRows.length).toBe(2)
    const savedRow = riceRows.find((r) => r.saved)
    expect(savedRow?.item_id).toBe(1)
    expect(savedRow?.name).toBe('Bulmex Rice 50Kg')
    const unsavedRow = riceRows.find((r) => !r.saved)
    expect(unsavedRow?.draft.entry_id).toBe(505)
    expect(unsavedRow?.draft.draft_price).toBe(52000)
    // No trailing draft:null duplicate rows.
    expect(body.rows.filter((r) => !r.draft).length).toBe(0)
  })
})
