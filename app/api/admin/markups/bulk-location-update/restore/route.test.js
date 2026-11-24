// app/api/admin/markups/bulk-location-update/restore/route.test.js
// Unit tests for the bulk-removal restore endpoint. Mocks the Supabase server
// client and the session validator so the real handler runs without a database.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/validation', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, validateSession: vi.fn() }
})

import { POST } from './route'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

const req = (body) =>
  new Request('http://x/api/admin/markups/bulk-location-update/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// Two orders stripped by one removal:
//   #10 Cash: a deleted 7-unit/₦1000 line, a 3-unit/₦500 line still there.
//   #11 Loan: a deleted 2-unit/₦500 line, a 1-unit/₦500 line still there.
const baseSnapshot = (overrides = {}) => ({
  id: 5,
  branch_code: 'ABE',
  cycle_id: 99,
  requested_skus: ['RICE50KG'],
  created_at: '2026-11-20T10:00:00.000Z',
  restored_at: null,
  payload: {
    orders: [
      { order_id: 10, status: 'Pending', total_amount: 1500, payment_option: 'Cash', cycle_id: 99 },
      { order_id: 11, status: 'Pending', total_amount: 1100, payment_option: 'Loan', cycle_id: 99 },
    ],
    lines: [
      { id: 1, order_id: 10, item_id: 1, branch_item_price_id: 700, qty: 7, unit_price: 100, amount: 1000 },
      { id: 2, order_id: 11, item_id: 1, branch_item_price_id: 700, qty: 2, unit_price: 250, amount: 500 },
    ],
  },
  ...overrides,
})

function makeSupabase({
  snapshot = baseSnapshot(),
  liveOrders = {
    10: { order_id: 10, status: 'Pending', payment_option: 'Cash', cycle_id: 99 },
    11: { order_id: 11, status: 'Pending', payment_option: 'Loan', cycle_id: 99 },
  },
  liveLines = [
    { id: 3, order_id: 10, qty: 3, amount: 500 },
    { id: 4, order_id: 11, qty: 1, amount: 500 },
  ],
  loanRates = { 99: 10 },
  insertError = null,
} = {}) {
  const state = {
    inserted: [],
    orderPatches: [],
    audit: [],
    snapshotPatch: null,
    lines: liveLines.map((l) => ({ ...l })),
  }

  return {
    state,
    from(table) {
      if (table === 'order_removal_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: snapshot, error: null }) }) }),
          update: (patch) => {
            state.snapshotPatch = patch
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === 'order_lines') {
        const chain = (filters) => {
          const promise = Promise.resolve().then(() => ({
            data: state.lines.filter((l) => filters.every(([col, val]) => l[col] === val)),
            error: null,
          }))
          return Object.assign(promise, { eq: (col, val) => chain([...filters, [col, val]]) })
        }
        return {
          select: () => chain([]),
          insert: (row) => {
            state.inserted.push(row)
            if (insertError) return Promise.resolve({ error: insertError })
            if (state.lines.some((l) => l.id === row.id)) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate key value' } })
            }
            state.lines.push({ ...row })
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'orders') {
        return {
          select: () => ({
            eq: (_col, val) => ({ maybeSingle: () => Promise.resolve({ data: liveOrders[val] || null, error: null }) }),
          }),
          update: (patch) => ({
            eq: (_col, val) => {
              state.orderPatches.push({ order_id: val, ...patch })
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'cycles') {
        return {
          select: () => ({
            eq: (_col, val) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { food_loan_interest_rate_pct: loanRates[val] ?? 13 },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === 'audit_log') {
        return {
          insert: (row) => {
            state.audit.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      return { select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }
    },
  }
}

beforeEach(() => {
  validateSession.mockReset()
  validateSession.mockResolvedValue({ valid: true, claims: { role: 'admin' } })
  createClient.mockReset()
})

describe('POST bulk-location-update/restore — auth and guards', () => {
  it('401 when the session is invalid', async () => {
    validateSession.mockResolvedValue({ valid: false })
    createClient.mockReturnValue(makeSupabase())
    const res = await POST(req({ snapshot_id: 5 }))
    expect(res.status).toBe(401)
  })

  it('409 when the snapshot was already restored', async () => {
    const data = makeSupabase({
      snapshot: baseSnapshot({ restored_at: '2026-11-21T09:00:00.000Z', restored_by: 'admin' }),
    })
    createClient.mockReturnValue(data)
    const res = await POST(req({ snapshot_id: 5 }))
    const b = await res.json()
    expect(res.status).toBe(409)
    expect(b.ok).toBe(false)
    expect(b.error).toMatch(/already been restored/i)
    // Nothing was put back and no order was touched.
    expect(data.state.inserted).toHaveLength(0)
    expect(data.state.orderPatches).toHaveLength(0)
  })

  it('400 without a snapshot_id', async () => {
    createClient.mockReturnValue(makeSupabase())
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('404 for an unknown snapshot', async () => {
    createClient.mockReturnValue(makeSupabase({ snapshot: null }))
    const res = await POST(req({ snapshot_id: 999 }))
    expect(res.status).toBe(404)
  })
})

describe('POST bulk-location-update/restore — putting the removal back', () => {
  it('re-inserts the deleted lines at their original price and recalculates total and qty', async () => {
    const data = makeSupabase()
    createClient.mockReturnValue(data)
    const res = await POST(req({ snapshot_id: 5 }))
    const b = await res.json()

    expect(res.status).toBe(200)
    expect(b.ok).toBe(true)
    expect(b.restored_lines).toBe(2)
    expect(b.errors).toEqual([])

    // Lines come back with their ids, original price and branch price pointer.
    expect(data.state.inserted).toEqual([
      { id: 1, order_id: 10, item_id: 1, branch_item_price_id: 700, qty: 7, unit_price: 100, amount: 1000 },
      { id: 2, order_id: 11, item_id: 1, branch_item_price_id: 700, qty: 2, unit_price: 250, amount: 500 },
    ])

    // Cash order: nothing but the line totals.
    const cash = data.state.orderPatches.find((p) => p.order_id === 10)
    expect(cash.total_amount).toBe(1500) // 500 remaining + 1000 restored
    expect(cash.total_qty).toBe(10) // 3 remaining + 7 restored
    expect(cash.status).toBeUndefined()
    expect(b.restored_orders.find((o) => o.order_id === 10).total_amount).toBe(1500)

    // Loan order: base 1000 + 10% cycle interest = 1100, three units.
    const loan = data.state.orderPatches.find((p) => p.order_id === 11)
    expect(loan.total_amount).toBe(1100)
    expect(loan.total_qty).toBe(3)
    expect(loan.status).toBeUndefined()

    // The snapshot is marked restored and the audit log records the undo.
    expect(data.state.snapshotPatch.restored_at).toBeTruthy()
    expect(data.state.audit).toHaveLength(2)
    expect(data.state.audit[0]).toMatchObject({
      module: 'food',
      action: 'restore_items',
      order_id: '10',
      detail: { snapshot_id: 5, branch_code: 'ABE' },
    })
  })

  it('uses the cycle loan rate, falling back to 13% when the cycle has none', async () => {
    const data = makeSupabase({ loanRates: { 98: 20 } })
    createClient.mockReturnValue(data)
    await POST(req({ snapshot_id: 5 }))
    // Rate for cycle 99 is unknown to the mock's cycle table → default 13%.
    const loan = data.state.orderPatches.find((p) => p.order_id === 11)
    expect(loan.total_amount).toBe(1130) // 1000 + 13%
  })

  it('skips a line that is already back instead of failing the run', async () => {
    const data = makeSupabase({
      liveLines: [
        { id: 1, order_id: 10, qty: 7, amount: 1000 },
        { id: 3, order_id: 10, qty: 3, amount: 500 },
        { id: 4, order_id: 11, qty: 1, amount: 500 },
      ],
    })
    createClient.mockReturnValue(data)
    const res = await POST(req({ snapshot_id: 5 }))
    const b = await res.json()
    expect(b.ok).toBe(true)
    expect(b.errors).toEqual([])
    expect(b.restored_lines).toBe(1) // line 1 already existed, only line 2 was inserted
    expect(data.state.orderPatches.find((p) => p.order_id === 10).total_amount).toBe(1500)
  })
})

describe('POST bulk-location-update/restore — order status', () => {
  it('reopens an order the removal cancelled', async () => {
    const data = makeSupabase({
      liveOrders: {
        10: { order_id: 10, status: 'Cancelled', payment_option: 'Cash', cycle_id: 99 },
        11: { order_id: 11, status: 'Pending', payment_option: 'Loan', cycle_id: 99 },
      },
    })
    createClient.mockReturnValue(data)
    await POST(req({ snapshot_id: 5 }))
    const cash = data.state.orderPatches.find((p) => p.order_id === 10)
    expect(cash.status).toBe('Pending') // the status the snapshot saw before removal
    expect(cash.total_amount).toBe(1500)
  })

  it('leaves a later status alone when the order is no longer Cancelled', async () => {
    const data = makeSupabase({
      liveOrders: {
        10: { order_id: 10, status: 'Delivered', payment_option: 'Cash', cycle_id: 99 },
        11: { order_id: 11, status: 'Cancelled', payment_option: 'Loan', cycle_id: 99 },
      },
    })
    createClient.mockReturnValue(data)
    const res = await POST(req({ snapshot_id: 5 }))
    const b = await res.json()
    const cash = data.state.orderPatches.find((p) => p.order_id === 10)
    expect(cash.status).toBeUndefined() // Delivered wins over the old Pending
    expect(b.restored_orders.find((o) => o.order_id === 10).status).toBe('Delivered')
    // The order the removal itself cancelled is reopened.
    expect(data.state.orderPatches.find((p) => p.order_id === 11).status).toBe('Pending')
  })

  it('never restores a Cancelled status that the snapshot itself recorded', async () => {
    const snapshot = baseSnapshot()
    snapshot.payload.orders[0].status = 'Cancelled'
    const data = makeSupabase({
      snapshot,
      liveOrders: {
        10: { order_id: 10, status: 'Cancelled', payment_option: 'Cash', cycle_id: 99 },
        11: { order_id: 11, status: 'Pending', payment_option: 'Loan', cycle_id: 99 },
      },
    })
    createClient.mockReturnValue(data)
    await POST(req({ snapshot_id: 5 }))
    expect(data.state.orderPatches.find((p) => p.order_id === 10).status).toBeUndefined()
  })
})
