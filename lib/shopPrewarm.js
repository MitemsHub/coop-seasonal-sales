// lib/shopPrewarm.js — pre-warms the member shop price cache at server boot
// so the first shopper per branch never pays the full round-trip price.
//
// Why: /api/items/prices caches per (branch, cycle) for 60s, so the first
// request of every cycle window re-runs the 6+ Supabase round-trips (branch
// lookup, view scan, markups, cancel-scope, items.source). At boot none of
// that is warm. We replicate the exact same fetch + cache-key logic here —
// NOT via a self-HTTP call to /api/items/prices (which would tie startup to
// the HTTP server being up and to middleware/pinning, and would double the
// compile cost) — and put the result in the SAME cache under the SAME key.
// The first real shopper then gets a cache hit instead of a cold build-up.
//
// Semantics chosen deliberately:
//   * Best-effort. Any error logs and moves on — a pre-warm failure must
//     never take down or delay the server boot (register() is awaited
//     before the first request is served, so we return immediately and
//     run in the background).
//   * Per-branch, sequential, with small timeouts so a wedged DB round-trip
//     cannot hang the process for minutes.
//   * Cycle-scoped to the SAME key the endpoint uses
//     (items-prices:<branch>:<cycle> or items-prices:<branch>).

import { createClient } from './supabaseServer'
import { cache, getCached } from './cache'
import { loadOverrides } from './itemOverrides'

const PREWARM_TTL_SECONDS = 60 // matches /api/items/prices

export const SHOP_PREWARM_TIMEOUT_MS = 15_000

/** Same cache-key shape /api/items/prices uses. */
export function shopPriceCacheKey(branchCode, activeCycleId) {
  return activeCycleId ? `items-prices:${branchCode}:${activeCycleId}` : `items-prices:${branchCode}`
}

// Per-branch fetch logic — a faithful mirror of /api/items/prices. Kept in
// one place (this module) rather than imported from the route because route
// modules are bundled per-entry by Next and importing them from
// instrumentation would pull server-only route context into boot. Changes
// here must be mirrored in app/api/items/prices/route.js (and vice versa) —
// a mismatch would leave the pre-warmed value wrong or stale-shaped.
async function fetchBranchPricedItems(supabase, branchCode, activeCycleId, hooks = {}) {
  const hasColumn = async (table, column) => {
    const { error } = await supabase.from(table).select(column).limit(1)
    return !error
  }

  const [markupsHasCycle, viewHasCycle] = await Promise.all([
    hasColumn('branch_item_markups', 'cycle_id'),
    hasColumn('v_inventory_status', 'cycle_id'),
  ])

  let cycleId = activeCycleId
  if (cycleId == null && (markupsHasCycle || viewHasCycle)) {
    let { data: active, error: activeErr } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
    if (activeErr) {
      const msg = String(activeErr?.message || '')
      if (!/is_active/i.test(msg)) throw activeErr
      active = null
    }
    if (active?.id) cycleId = active.id
    if (!cycleId) {
      const { data: latest, error: latestErr } = await supabase
        .from('cycles')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestErr) throw latestErr
      cycleId = latest?.id ?? null
    }
  }

  const cacheKey = shopPriceCacheKey(branchCode, cycleId)
  hooks.onCacheKey?.(cacheKey)

  return getCached(cacheKey, async () => {
    const { data: branch, error: brErr } = await supabase
      .from('branches')
      .select('id, code')
      .eq('code', branchCode)
      .single()
    if (brErr || !branch) throw new Error('Branch not found')

    let itemsQuery = supabase
      .from('v_inventory_status')
      .select(
        `
          price,
          total_demand,
          pending_demand,
          confirmed_demand,
          delivered_demand,
          item_id,
          item_name,
          sku,
          unit,
          category
        `
      )
      .eq('branch_code', branchCode)
      .gt('price', 0)
      .order('item_name')
    if (viewHasCycle && cycleId) itemsQuery = itemsQuery.eq('cycle_id', cycleId)
    const { data: itemsWithPrices, error } = await itemsQuery
    if (error) throw new Error('Failed to fetch items')

    let markupsQuery = supabase
      .from('branch_item_markups')
      .select('item_id, amount, active')
      .eq('branch_id', branch.id)
    if (markupsHasCycle && cycleId) markupsQuery = markupsQuery.eq('cycle_id', cycleId)
    const { data: markups, error: muErr } = await markupsQuery
    if (muErr) console.warn('Markups fetch error (prewarm):', muErr.message)
    const markupByItemId = new Map((markups || []).filter((m) => m.active).map((m) => [m.item_id, Number(m.amount || 0)]))

    // Branch-cancelled survey entries hide their linked OUTSOURCED products
    // from the shop — same rule as /api/items/prices.
    let cancelledItemIds = new Set()
    {
      const subsFilter = cycleId != null ? 'cycle_id.eq.' + Number(cycleId) + ',cycle_id.is.null' : 'cycle_id.is.null'
      const { data: subs } = await supabase
        .from('food_survey_submissions')
        .select('id')
        .eq('branch_id', branch.id)
        .or(subsFilter)
      const subIds = (subs || []).map((s) => s.id)
      if (subIds.length) {
        const { data: ents } = await supabase
          .from('food_survey_entries')
          .select('cancelled, saved_item_id')
          .in('submission_id', subIds)
        const rawLinks = new Set()
        for (const e of ents || []) {
          if (e.cancelled === true && e.saved_item_id != null) rawLinks.add(Number(e.saved_item_id))
        }
        if (rawLinks.size) {
          const { data: linkItems } = await supabase
            .from('items')
            .select('item_id, source')
            .in('item_id', [...rawLinks])
          if (linkItems && linkItems.length) {
            for (const li of linkItems) {
              if ((li.source || 'general') === 'outsourced') cancelledItemIds.add(li.item_id)
            }
          } else {
            for (const id of rawLinks) cancelledItemIds.add(id)
          }
        }
      }
    }

    // Branch-owned display fields (item_branch_overrides) — mirrored from
    // /api/items/prices so the pre-warm hits and the real request can never
    // disagree on the branch's card.
    const overrides = await loadOverrides((itemsWithPrices || []).map((r) => r.item_id))

    return (itemsWithPrices || [])
      .filter((row) => !cancelledItemIds.has(row.item_id))
      .map((row) => {
        const base = Number(row.price || 0)
        const mk = markupByItemId.get(row.item_id) || 0
        // Same field rules as /api/items/prices: a non-null name wins,
        // ''-name falls back (never shown empty); '' category/unit is a
        // deliberate clerical clear and stays empty.
        const co = overrides.get(`${branch.id}::${row.item_id}`)
        return {
          id: row.item_id,
          name: co?.name != null && co.name !== '' ? co.name : row.item_name,
          sku: row.sku,
          unit: co?.unit != null ? co.unit : row.unit,
          category: co?.category != null ? co.category : row.category,
          price: base + mk,
          demand: {
            total: Number(row.total_demand || 0),
            pending: Number(row.pending_demand || 0),
            confirmed: Number(row.confirmed_demand || 0),
            delivered: Number(row.delivered_demand ?? row.delivered_qty ?? 0),
          },
        }
      })
  }, PREWARM_TTL_SECONDS)
}

/**
 * Warm one branch's shop cache entry. Returns { ok, branchCode, cacheKey,
 * itemCount, error } and never throws.
 */
export async function prewarmBranchShop(supabase, branchCode, { activeCycleId = null, timeoutMs = SHOP_PREWARM_TIMEOUT_MS, hooks = {} } = {}) {
  const started = Date.now()
  try {
    const task = fetchBranchPricedItems(supabase, branchCode, activeCycleId, hooks)
    const result = await Promise.race([
      task,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`prewarm timeout after ${timeoutMs}ms`)), timeoutMs)),
    ])
    return { ok: true, branchCode, itemCount: Array.isArray(result) ? result.length : 0, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, branchCode, error: e?.message || String(e), ms: Date.now() - started }
  }
}

/**
 * Pre-warm every branch's member-shop cache entry. Fire-and-forget: spawns
 * the work in the background and returns immediately so register()'s await
 * of it never delays boot. Sequential per branch (the DB pool is shared with
 * cold-start request serving — hammering it in parallel would slow the very
 * first shoppers we're trying to warm for). Returns the spawned promise for
 * tests to await.
 */
export function prewarmShopCache({ branches = null, timeoutMs = SHOP_PREWARM_TIMEOUT_MS, hooks = {} } = {}) {
  const run = async () => {
    try {
      const supabase = createClient()
      let list = branches
      if (!list) {
        const { data, error } = await supabase.from('branches').select('code').order('name')
        if (error) throw error
        list = data || []
      }
      const codes = [...new Set(list.map((b) => b.code).filter(Boolean))]
      if (!codes.length) {
        console.log('[prewarm-shop] no branches found — nothing to warm')
        return { warmed: 0, failed: 0 }
      }
      console.log(`[prewarm-shop] warming member shop cache for ${codes.length} branch(es)…`)
      let warmed = 0
      let failed = 0
      // Resolve the ACTIVE cycle ONCE (same fallback chain the endpoint
      // uses) so all branches land in the same per-cycle cache key.
      let activeCycleId = null
      {
        let { data: active, error: activeErr } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
        if (activeErr) {
          const msg = String(activeErr?.message || '')
          if (!/is_active/i.test(msg)) {
            throw activeErr
          }
          active = null
        }
        if (active?.id) {
          activeCycleId = active.id
        } else {
          const { data: latest, error: latestErr } = await supabase
            .from('cycles')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (latestErr) throw latestErr
          activeCycleId = latest?.id ?? null
        }
      }
      for (const code of codes) {
        const r = await prewarmBranchShop(supabase, code, { activeCycleId, timeoutMs, hooks })
        if (r.ok) {
          warmed++
          console.log(`[prewarm-shop] ${code}: ${r.itemCount} items in ${r.ms}ms (key ${shopPriceCacheKey(code, activeCycleId)})`)
        } else {
          failed++
          console.warn(`[prewarm-shop] ${code}: failed — ${r.error}`)
        }
      }
      console.log(`[prewarm-shop] done: ${warmed} warmed, ${failed} failed`)
      return { warmed, failed }
    } catch (e) {
      console.warn('[prewarm-shop] aborted:', e?.message || e)
      return { warmed: 0, failed: 0, aborted: true }
    }
  }
  // Don't await — boot must never block on the DB.
  return run()
}
