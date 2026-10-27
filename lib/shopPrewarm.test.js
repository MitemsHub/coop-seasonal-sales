// lib/shopPrewarm.test.js — pins the boot-time member-shop pre-warm:
// cache keys shared with the endpoint, best-effort failure isolation,
// branch-cancelled outsourced exclusion identical to the shop, and
// fire-and-forget boot semantics.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./supabaseServer', () => ({ createClient: vi.fn() }))

import { cache } from './cache'
import { createClient } from './supabaseServer'
import { prewarmBranchShop, prewarmShopCache, shopPriceCacheKey, SHOP_PREWARM_TIMEOUT_MS } from './shopPrewarm.js'

// ── fake supabase builder ───────────────────────────────────────────────
// PostgREST semantics:
//   * awaiting the builder resolves { data: rows[], error } (FULL array)
//   * .single()/.maybeSingle() return ONE row (first element or null)
function makeSupabase(tables = {}) {
  const seenProbes = []
  const one = (table) => {
    const r = tables[table] || { data: [], error: null }
    return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data ?? null, error: r.error ?? null }
  }
  const all = (table) => tables[table] || { data: [], error: null }
  const make = (table) => {
    const node = {
      select: (col) => {
        // hasColumn(table, column) probe select.
        seenProbes.push({ table, col })
        return node
      },
      eq: () => node,
      gt: () => node,
      or: () => node,
      in: () => node,
      order: () => node,
      limit: () => node,
      single: () => Promise.resolve(one(table)),
      maybeSingle: () => Promise.resolve(one(table)),
      // Await the builder directly → the list result (PostgREST shape).
      then(onF, onJ) {
        return Promise.resolve(all(table)).then(onF, onJ)
      },
    }
    return node
  }
  return { from: make, seenProbes }
}

const AKURE = { code: 'AKURE', id: 33 }

beforeEach(() => {
  cache.clear()
  createClient.mockReset()
})

afterEach(() => {
  cache.clear()
})

describe('shopPriceCacheKey', () => {
  it('matches the endpoint key shape (branch + cycle)', () => {
    expect(shopPriceCacheKey('AKURE', 9)).toBe('items-prices:AKURE:9')
    expect(shopPriceCacheKey('AKURE', null)).toBe('items-prices:AKURE')
  })
})

describe('prewarmBranchShop', () => {
  it('fills the shared cache under the exact endpoint key', async () => {
    const supabase = makeSupabase({
      branches: { data: [AKURE] },
      cycles: { data: [{ id: 9 }] },
      v_inventory_status: {
        data: [
          { item_id: 1, item_name: 'Golden Penny Semovita 1Kg', sku: 'GPN-SEM', unit: 'Bag', category: 'Cereals', price: 15000, total_demand: 2, pending_demand: 1, confirmed_demand: 0, delivered_demand: 1 },
        ],
      },
    })
    const onCacheKey = vi.fn()
    const r = await prewarmBranchShop(supabase, 'AKURE', { activeCycleId: 9, hooks: { onCacheKey } })
    expect(r.ok).toBe(true)
    expect(onCacheKey).toHaveBeenCalledWith('items-prices:AKURE:9')
    const cached = cache.get('items-prices:AKURE:9')
    expect(Array.isArray(cached)).toBe(true)
    expect(cached).toHaveLength(1)
    expect(cached[0]).toMatchObject({ id: 1, name: 'Golden Penny Semovita 1Kg', price: 15000 })
    expect(cached[0].demand).toMatchObject({ total: 2, pending: 1, confirmed: 0, delivered: 1 })
  })

  it('excludes branch-cancelled OUTSOURCED items exactly like the shop does', async () => {
    const supabase = makeSupabase({
      branches: { data: [AKURE] },
      cycles: { data: [{ id: 9 }] },
      v_inventory_status: {
        data: [
          { item_id: 7, item_name: 'Rep Twin Semovita', sku: 'REP-SEM', unit: 'Bag', category: 'Cereals', price: 15000 },
          { item_id: 3, item_name: 'Golden Penny Semovita 1Kg', sku: 'GPN-SEM', unit: 'Bag', category: 'Cereals', price: 15000 },
        ],
      },
      food_survey_submissions: { data: [{ id: 21 }] },
      food_survey_entries: { data: [{ cancelled: true, saved_item_id: 7 }] },
      items: {
        data: [
          { item_id: 7, source: 'outsourced' },
          { item_id: 3, source: 'general' },
        ],
      },
    })
    const r = await prewarmBranchShop(supabase, 'AKURE', { activeCycleId: 9 })
    expect(r.ok).toBe(true)
    const cached = cache.get('items-prices:AKURE:9')
    expect(cached.map((i) => i.id)).toEqual([3]) // outsourced twin hidden, General twin sells
  })

  it('keeps a cancelled draft from hiding a product another LIVE entry still sells', async () => {
    // Lagos's Kings Oil 5L case: the stale draft was cancelled while the
    // rep's resubmission stayed live — both link to item 7. The cancelled
    // link alone must not pull the working product off the shelf.
    const supabase = makeSupabase({
      branches: { data: [AKURE] },
      cycles: { data: [{ id: 9 }] },
      v_inventory_status: {
        data: [
          { item_id: 7, item_name: "King's Oil 5Ltrs", sku: 'KINGS5L', unit: 'Carton', category: 'Vegetable Oil', price: 65000 },
          { item_id: 3, item_name: 'Golden Penny Semovita 1Kg', sku: 'GPN-SEM', unit: 'Bag', category: 'Cereals', price: 15000 },
        ],
      },
      food_survey_submissions: { data: [{ id: 21 }] },
      food_survey_entries: {
        data: [
          { cancelled: true, saved_item_id: 7 },
          { cancelled: false, saved_item_id: 7 },
        ],
      },
      items: {
        data: [
          { item_id: 7, source: 'outsourced' },
          { item_id: 3, source: 'general' },
        ],
      },
    })
    const r = await prewarmBranchShop(supabase, 'AKURE', { activeCycleId: 9 })
    expect(r.ok).toBe(true)
    const cached = cache.get('items-prices:AKURE:9')
    expect(cached.map((i) => i.id)).toEqual([7, 3]) // live link keeps 7 on the shelf
  })

  it('applies active markups like the endpoint (base + markup)', async () => {
    const supabase = makeSupabase({
      branches: { data: [AKURE] },
      cycles: { data: [{ id: 9 }] },
      v_inventory_status: {
        data: [{ item_id: 5, item_name: 'Rice', sku: 'RICE', unit: 'Bag', category: 'Staples', price: 50000 }],
      },
      branch_item_markups: {
        data: [
          { item_id: 5, amount: 1500, active: true },
          { item_id: 6, amount: 900, active: false },
        ],
      },
    })
    await prewarmBranchShop(supabase, 'AKURE', { activeCycleId: 9 })
    const cached = cache.get('items-prices:AKURE:9')
    expect(cached[0].price).toBe(51500)
  })

  it('does not throw on branch lookup failure — returns { ok:false, error }', async () => {
    const broken = {
      from: () => {
        const node = {
          select: () => node,
          limit: () => Promise.resolve({ error: null }),
          eq: () => node,
          single: () => Promise.resolve({ data: null, error: { message: 'row not found' } }),
        }
        return node
      },
    }
    const r = await prewarmBranchShop(broken, 'GHOST', { activeCycleId: 9 })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('times out a wedged fetch instead of hanging boot', async () => {
    const hanging = {
      from: () => {
        const node = { select: () => node, limit: () => new Promise(() => {}) }
        return node
      },
    }
    const r = await prewarmBranchShop(hanging, 'AKURE', { activeCycleId: 9, timeoutMs: 50 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('timeout')
  })

  it('SHOP_PREWARM_TIMEOUT_MS is bounded so boot can never hang for minutes', () => {
    expect(SHOP_PREWARM_TIMEOUT_MS).toBeLessThanOrEqual(20_000)
    expect(SHOP_PREWARM_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe('prewarmShopCache', () => {
  it('resolves the active cycle once and warms every branch under the shared key', async () => {
    const supabase = makeSupabase({
      branches: { data: [AKURE, { code: 'ABEOKUTA', id: 1 }] },
      cycles: { data: [{ id: 9 }] },
      v_inventory_status: { data: [] },
    })
    createClient.mockReturnValue(supabase)
    const result = await prewarmShopCache()
    expect(result.warmed).toBe(2)
    expect(result.failed).toBe(0)
    expect(cache.get('items-prices:AKURE:9')).toEqual([]) // cycle-keyed, filled even when empty
    expect(cache.get('items-prices:ABEOKUTA:9')).toEqual([])
    expect(cache.has('items-prices:AKURE')).toBe(false) // not the cycle-less legacy key
  })

  it('dedupes branch codes and skips blanks', async () => {
    const supabase = makeSupabase({
      branches: {
        data: [
          { code: 'AKURE', id: 33 },
          { code: 'AKURE', id: 33 },
          { code: '', id: 9 },
          { code: null, id: 10 },
        ],
      },
      cycles: { data: [{ id: 9 }] },
    })
    createClient.mockReturnValue(supabase)
    const result = await prewarmShopCache()
    expect(result.warmed).toBe(1)
  })

  it('a branch whose own lookups fail counts as failed and never blocks the loop', async () => {
    // List succeeds (so codes are known) but the per-branch row lookup
    // (.eq(…).single()) fails → each branch counts as failed while the
    // loop continues and finishes without throwing.
    const make = (table) => {
      let usedEq = false
      const node = {
        select: () => node,
        eq: () => {
          usedEq = true
          return node
        },
        gt: () => node,
        or: () => node,
        in: () => node,
        order: () => node,
        limit: () => node,
        single: () =>
          usedEq
            ? Promise.resolve({ data: null, error: { message: 'row not found' } })
            : Promise.resolve(one(table)),
        maybeSingle: () => Promise.resolve(one(table)),
        then(onF, onJ) {
          return Promise.resolve(all(table)).then(onF, onJ)
        },
      }
      return node
    }
    const supabase = { from: make }
    // Per-branch failure, via query tracking: the branch row (.eq → .single)
    // succeeds, but the inventory view (gt-flagged) resolves with a DB error
    // → fetch throws → each branch counts as failed while the loop finishes.
    const tables = {
      branches: { data: [{ code: 'BAD1', id: 1 }, { code: 'BAD2', id: 2 }] },
      cycles: { data: [{ id: 9 }] },
    }
    const one = (t) => {
      const r = tables[t] || { data: [], error: null }
      return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data ?? null, error: r.error ?? null }
    }
    const all = (t) => tables[t] || { data: [], error: null }
    let viewCalls = 0
    supabase.from = (table) => {
      let gtUsed = false
      const node = {
        select: () => node,
        eq: () => node,
        gt: () => {
          gtUsed = true
          return node
        },
        or: () => node,
        in: () => node,
        order: () => node,
        limit: () => node,
        single: () => Promise.resolve(one(table)),
        maybeSingle: () => Promise.resolve(one(table)),
        then(onF, onJ) {
          const failedView = gtUsed
          if (failedView) viewCalls++
          return Promise.resolve(
            failedView ? { data: null, error: { message: 'view gone' } } : all(table)
          ).then(onF, onJ)
        },
      }
      return node
    }
    createClient.mockReturnValue(supabase)
    const result = await prewarmShopCache()
    expect(viewCalls).toBe(2) // both branches actually attempted the view
    expect(result.warmed).toBe(0)
    expect(result.failed).toBe(2) // isolated per branch; loop completed
  })

  it('swallows a dead branches table (aborted, no throw) — boot unaffected', async () => {
    // The branches list await settles with { data: null } (PostgREST error
    // shape) → list.map throws inside run() → caught → aborted.
    const broken = {
      from: () => {
        const node = {
          select: () => node,
          limit: () => Promise.resolve({ error: { message: 'db down' } }),
          eq: () => node,
          order: () => node,
          single: () => Promise.resolve({ data: null, error: { message: 'db down' } }),
          maybeSingle: () => Promise.resolve({ data: null, error: { message: 'db down' } }),
          then(onF, onJ) {
            return Promise.resolve({ data: null, error: { message: 'db down' } }).then(onF, onJ)
          },
        }
        return node
      },
    }
    createClient.mockReturnValue(broken)
    const result = await prewarmShopCache()
    expect(result.aborted).toBe(true) // logged + swallowed, boot unaffected
    expect(result.warmed).toBe(0)
  })
})
