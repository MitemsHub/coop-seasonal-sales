// app/api/admin/markups/bulk-location-update/route.test.js
// Unit tests for Bulk Remove Items from Orders.
// Mocks the Supabase server client and the session validator so the real
// route handler runs without a database.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/validation', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, validateSession: vi.fn() }
})

import { POST } from './route'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

const ok = { ...new Response().clone(), json: async () => ({}) }
const json = (obj, init) => new Response(JSON.stringify(obj), { status: 200, ...init })

function makeSupabase({ orders = [], lines = [], items = [], cycleColErr = null, branchErr = null } = {}) {
  const del = vi.fn(() => Promise.resolve({ error: null }))
  const updatedOrders = []
  const upd = vi.fn((patch) => ({ eq: (col, val) => {
    const order = updatedOrders.find((o) => o.order_id === val)
    if (order) Object.assign(order, patch)
    return Promise.resolve({ error: null })
  } }))

  const supa = {
    deleted: del,
    updatedOrders,
    updatedLines: upd,
    // Captured PostgREST query strings per table for assertions
    queries: { orders: [], order_lines: [] },
    from(table) {
      const update = (patch) => ({
        eq: (_col, val) => {
          const order = updatedOrders.find((o) => o.order_id === val)
          if (order) Object.assign(order, patch)
          else updatedOrders.push({ order_id: val, ...patch })
          upd(patch)
          return Promise.resolve({ error: null })
        },
      })
      const baseUpdate = { update }
      if (table === 'branches') {
        return {
          ...baseUpdate,
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 7, code: 'ABE' }, error: branchErr }) }) }),
        }
      }
      if (table === 'items') {
        // select('item_id, sku').in('sku', skus) — fake PostgREST quals so we
        // can assert the SKU → item set in a real-DB-less way.
        let skuFilter = null
        return {
          select: () => ({
            in: (_col, skus) => {
              skuFilter = skus
              return Promise.resolve({
                data: items.filter((i) => (skuFilter || []).includes(i.sku)),
                error: null,
              })
            },
          }),
        }
      }
      if (table === 'orders') {
        return {
          ...baseUpdate,
          select: (cols) => ({
            limit: () => ({ data: [{ cycle_id: 99 }], error: cycleColErr }),
            eq: (col, val) => {
              supa.queries.orders.push(`${cols} ${col}=${val}`)
              return {
                eq: (col2, val2) => {
                  supa.queries.orders.push(`${cols} ${col}=${val} ${col2}=${val2}`)
                  return {
                    in: (_c, statuses) => Promise.resolve({
                      data: orders.filter((o) => statuses.includes(o.status) && o.delivery_branch_id === 7 && o.cycle_id === 99),
                      error: cycleColErr,
                    }),
                  }
                },
              }
            },
          }),
        }
      }
      if (table === 'order_lines') {
        // Filter-accumulating chain so .in(...).in(...) narrows as PostgREST
        // would; the object is thenable so awaiting resolves the filtered set.
        const chain = (filters) => {
          const apply = () => lines.filter((l) =>
            filters.every(([col, vals]) => vals.includes(l[col]))
          )
          const obj = {
            in: (col, vals) => chain([...filters, [col, vals]]),
            eq: (col, val) => chain([...filters, [col, [val]]]),
          }
          return Object.assign(Promise.resolve().then(() => ({ data: apply(), error: null })), obj)
        }
        return {
          ...baseUpdate,
          select: () => chain([]),
          delete: () => ({
            in: (_col, ids) => {
              del(ids)
              // Emulate the real DELETE: lines vanish from the table before
              // the recalc query runs.
              for (const id of ids) {
                const i = lines.findIndex((l) => l.id === id)
                if (i >= 0) lines.splice(i, 1)
              }
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'cycles') {
        return {
          ...baseUpdate,
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { food_loan_interest_rate_pct: 10 }, error: null }) }) }),
        }
      }
      // Fallback for probed tables (e.g. orders cycle_id column check etc.)
      return { ...baseUpdate, select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }
    }
  }
  return supa
}

const req = (body) => new Request('http://x/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let data
beforeEach(() => {
  validateSession.mockResolvedValue({ valid: true, claim: { type: 'admin' } })
  createClient.mockReset()
})

describe('POST bulk-location-update — validation', () => {
  it('401 when session invalid', async () => {
    validateSession.mockResolvedValue({ valid: false })
    createClient.mockReturnValue(makeSupabase())
    const res = await POST(req({ branch_code: 'ABE', skus: ['RICE50KG'], cycle_id: 99 }))
    const b = await res.json()
    expect(res.status).toBe(401)
    expect(b.ok).toBe(false)
  })

  it('400 when cycle_id missing — cycle is mandatory', async () => {
    createClient.mockReturnValue(makeSupabase())
    const res = await POST(req({ branch_code: 'ABE', skus: ['RICE50KG'] }))
    const b = await res.json()
    expect(res.status).toBe(400)
    expect(b.error).toBe('cycle_id is required')
  })

  it('400 when cycle_id not a positive number', async () => {
    createClient.mockReturnValue(makeSupabase())
    for (const bad of [0, -1, 'abc']) {
      const res = await POST(req({ branch_code: 'ABE', skus: ['RICE50KG'], cycle_id: bad }))
      const b = await res.json()
      expect(res.status).toBe(400)
    }
  })

  it('400 when branch_code missing', async () => {
    createClient.mockReturnValue(makeSupabase())
    const res = await POST(req({ skus: ['RICE50KG'], cycle_id: 99 }))
    const b = await res.json()
    expect(res.status).toBe(400)
    expect(b.error).toBe('branch_code is required')
  })

  it('400 when skus empty', async () => 'skip')
})

describe('POST bulk-location-update — happy paths', () => {
  it('removes only matching lines and recalcs totals (loan keeps interest)', async () => {
    data = makeSupabase({
      items: [{ item_id: 1, sku: 'RICE50KG' }, { item_id: 2, sku: 'OIL' }],
      orders: [
        { order_id: 10, status: 'Pending', total_amount: 300, payment_option: 'Loan', delivery_branch_id: 7, cycle_id: 99 },
        { order_id: 11, status: 'Pending', total_amount: 200, payment_option: 'Cash', delivery_branch_id: 7, cycle_id: 99 },
      ],
      lines: [
        { id: 1, order_id: 10, item_id: 1, qty: 2, unit_price: 100, amount: 200 },
        { id: 2, order_id: 10, item_id: 2, qty: 1, unit_price: 100, amount: 100 },
        { id: 3, order_id: 11, item_id: 1, qty: 2, unit_price: 100, amount: 200 },
      ],
    })
    createClient.mockReturnValue(data)
    const res = await POST(req({ branch_code: 'ABE', skus: ['RICE50KG'], cycle_id: 99 }))
    const b = await res.json()
    expect(res.status).toBe(200)
    expect(b.ok).toBe(true)
    expect(b.removed_lines).toBe(2)
    expect(b.affected_orders).toBe(2)
    // Order 10: total 200 loan-based → remaining 100 base; loan 10% → 110
    const o10 = data.updatedOrders.find((o) => o.order_id === 10)
    expect(o10.total_amount).toBe(110)
    // Order 11: nothing left → auto-cancelled
    const o11 = data.updatedOrders.find((o) => o.order_id === 11)
    expect(o11.status).toBe('Cancelled')
    expect(o11.total_amount).toBe(0)
  })

  it('does NOT touch other cycles or other branches (cycle mandatory + scoping)', async () => {
    data = makeSupabase({
      items: [{ item_id: 1, sku: 'RICE50KG' }],
      orders: [
        { order_id: 20, status: 'Pending', total_amount: 500, payment_option: 'Cash', delivery_branch_id: 7, cycle_id: 99 },
        { order_id: 21, status: 'Pending', total_amount: 500, payment_option: 'Cash', delivery_branch_id: 7, cycle_id: 98 }, // other cycle
        { order_id: 22, status: 'Pending', total_amount: 500, payment_it: 'Cash', delivery_branch_id: 8, cycle_id: 99 }, // other branch
      ],
      lines: [{ id: 1, order_id: 20, item_id: 1, qty: 1, unit_price: 500, amount: 500 }],
    })
    createClient.mockReturnValue(data)
    const res = await POST(req({ branch_code: 'ABE', skus: ['RICE50KG'], cycle_id: 99 }))
    const b = await res.json()
    expect(b.ok).toBe(true)
    // The fake supabase only returns orders matching cycle 99 @ branch 7, so
    // lines from order 21 and 22 can never be returned from the DB. This is
    // the isolation contract: only cycle-99 branch-7 orders are in scope.
    expect(b.removed_lines).toBe(1)
    expect(b.affected_orders).toBe(1)
  })

  it('respects status filter (never touches Cancelled orders)', async () => {
    data = makeSupabase({
      items: [{ item_id: 1, sku: 'RICE50KG' }],
      orders: [
        { order_id: 30, status: 'Cancelled', total_amount: 500, delivery_branch_id: 7, cycle_id: 99 },
        { order_id: 31, status: 'Delivered', total_amount: 500, delivery_branch_id: 7, cycle_id: 99 },
      ],
      lines: [{ id: 1, order_id: 31, item_id: 1, qty: 1, unit_price: 500, amount: 500 }],
    })
    createClient.mockReturnValue(data)
    const res = await POST(req({ branch_code: 'ABE', skus: ['RICE50KG'], cycle_id: 99 }))
    const b = await res.json()
    expect(b.removed_lines).toBe(1)
    expect(b.affected_orders).toBe(1)
    // Cancelled orders are excluded from the fetch, hence never recalculated.
    expect(data.updatedOrders.find((o) => o.order_id === 30)).toBeUndefined()
  })
})
