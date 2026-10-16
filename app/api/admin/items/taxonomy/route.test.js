// app/api/admin/items/taxonomy/route.test.js
// Regression tests for the Categories & units pick lists.
//
// The Akure/Oil regression: the GET merge used to turn the SURVEY CATALOG's
// product-name rows ("King's Oil") into category chips, so a category the
// admin had cleaned up ("Vegetable Oil") kept a ghost sibling in the panel
// forever. The catalog now contributes units only; categories come from
// saved items and admin-added item_taxonomy rows.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/directDb', () => ({ queryDirect: vi.fn().mockResolvedValue({}) }))

import { GET, POST } from './route'
import { createClient } from '@/lib/supabaseServer'

function makeSupabase({ items = [], catalog = [], custom = [] } = {}) {
  const chain = (data) => {
    const node = {
      data,
      error: null,
      select: () => node,
      eq: () => node,
      order: () => node,
      upsert: () => Promise.resolve({ data: null, error: null }),
    }
    return node
  }
  return {
    from(table) {
      if (table === 'items') return chain(items)
      if (table === 'food_survey_catalog') return chain(catalog)
      if (table === 'item_taxonomy') return chain(custom)
      return chain([])
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('taxonomy GET — categories come from items, not catalog product names', () => {
  it('drops the stale catalog product name that a re-categorised item replaced (King\'s Oil → Vegetable Oil)', async () => {
    createClient.mockReturnValue(
      makeSupabase({
        // Every oil item is saved as Vegetable Oil…
        items: [
          { category: 'Vegetable Oil' },
          { category: 'Vegetable Oil' },
          { category: 'Rice' },
        ],
        // …yet the survey catalog still carries the pre-cleanup
        // product-name row. It must NOT regrow a "King's Oil" chip.
        catalog: [
          { name: "King's Oil", unit: 'Gallon' },
          { name: 'Rice', unit: 'Bag' },
        ],
        custom: [],
      })
    )
    const res = await GET()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.categories).toContain('Vegetable Oil')
    expect(body.categories).not.toContain("King's Oil")
    expect(body.categories).toEqual(['Rice', 'Vegetable Oil'])
  })

  it('keeps units from the catalog and merges admin-added entries and defaults', async () => {
    createClient.mockReturnValue(
      makeSupabase({
        items: [{ category: 'Cereals' }],
        catalog: [{ name: 'Cereals', unit: 'Carton' }],
        custom: [
          { kind: 'unit', value: 'Pack' },
          { kind: 'category', value: 'Custard' },
        ],
      })
    )
    const res = await GET()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.categories).toEqual(['Cereals', 'Custard'])
    expect(body.units).toContain('Carton') // from catalog
    expect(body.units).toContain('Pack') // admin-added
    expect(body.units).toContain('Bag') // default set
  })

  it('ignores blank categories and dedupes whitespace variants via norm (case is preserved as-is)', async () => {
    createClient.mockReturnValue(
      makeSupabase({
        items: [{ category: 'Vegetable  Oil' }, { category: 'Vegetable Oil' }, { category: '' }],
        catalog: [],
        custom: [],
      })
    )
    const res = await GET()
    const body = await res.json()
    expect(body.categories).toEqual(['Vegetable Oil'])
  })
})

describe('taxonomy POST — validation', () => {
  it('rejects a bad kind', async () => {
    createClient.mockReturnValue(makeSupabase())
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ kind: 'nonsense', value: 'Rice' }) })
    )
    expect((await res.json()).ok).toBe(false)
  })

  it('rejects an too-short value', async () => {
    createClient.mockReturnValue(makeSupabase())
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ kind: 'category', value: 'A' }) })
    )
    expect((await res.json()).ok).toBe(false)
  })
})
