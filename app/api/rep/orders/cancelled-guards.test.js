// Focused tests for the Rep cancelled-order read-only guards.
// Every rep mutation route is exercised against a Cancelled order; none may
// write, delete, or call an RPC.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/validation', () => ({ validateSession: vi.fn() }))
vi.mock('@/lib/signing', () => ({ verify: vi.fn() }))
vi.mock('@/lib/csrf', () => ({ csrfGuard: vi.fn() }))

import { POST as cancelOrder } from './cancel/route'
import { POST as deleteOrder } from './delete/route'
import { PUT as updateOrder } from './update/route'
import { POST as deliverOrder } from './deliver/route'
import { POST as postOrder } from './post/route'
import { createClient as createServerClient } from '@/lib/supabaseServer'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { validateSession } from '@/lib/validation'
import { verify } from '@/lib/signing'
import { csrfGuard } from '@/lib/csrf'

function makeSupabase(order, { allowWrites = false } = {}) {
  const state = { updates: 0, deletes: 0, rpcs: 0, audits: 0 }

  const client = {
    from(table) {
      if (table === 'orders') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          limit: async () => ({ data: [{ cycle_id: 9 }], error: null }),
          single: async () => ({ data: order, error: null }),
          maybeSingle: async () => ({ data: order, error: null }),
          update: () => {
            state.updates += 1
            if (!allowWrites) {
              throw new Error('order update must not run for a Cancelled order')
            }
            return { eq: async () => ({ error: null }) }
          },
          delete: () => {
            state.deletes += 1
            if (!allowWrites) {
              throw new Error('order delete must not run for a Cancelled order')
            }
            return { eq: async () => ({ error: null }) }
          },
        }
        return chain
      }

      if (table === 'branch_item_prices') {
        return {
          select: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }
      }

      if (table === 'audit_log') {
        return {
          insert: async () => {
            state.audits += 1
            return { error: null }
          },
        }
      }

      throw new Error(`Unexpected table in cancelled-order test: ${table}`)
    },
    rpc: vi.fn(async () => {
      state.rpcs += 1
      return { data: { success: true }, error: null }
    }),
  }

  return { client, state }
}

function request(body) {
  const req = new Request('http://x/api/rep/orders/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: 'http://x',
      host: 'x',
      'x-forwarded-proto': 'http',
    },
    body: JSON.stringify(body),
  })
  req.cookies = { get: () => ({ value: 'rep-token' }) }
  return req
}

function cancelledOrder() {
  return {
    order_id: 55,
    status: 'Cancelled',
    delivery_branch_id: 1,
    cycle_id: 9,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  csrfGuard.mockReturnValue(null)
  verify.mockReturnValue({
    role: 'rep',
    branch_id: 1,
    module: 'food',
    branch_code: 'CALABAR',
  })
  validateSession.mockResolvedValue({
    valid: true,
    claims: { branch_id: 1, module: 'food', branch_code: 'CALABAR' },
  })
})

describe('rep cancelled-order guards', () => {
  it('does not let a rep cancel a Cancelled order', async () => {
    const { client, state } = makeSupabase(cancelledOrder())
    createServerClient.mockReturnValue(client)

    const res = await cancelOrder(request({ orderId: 55, reason: 'retry' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/pending/i)
    expect(state.updates).toBe(0)
    expect(state.deletes).toBe(0)
    expect(state.rpcs).toBe(0)
    expect(state.audits).toBe(0)
  })

  it('does not let a rep delete a Cancelled order', async () => {
    const { client, state } = makeSupabase(cancelledOrder())
    createServerClient.mockReturnValue(client)

    const res = await deleteOrder(request({ orderId: 55 }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/pending/i)
    expect(state.deletes).toBe(0)
    expect(state.rpcs).toBe(0)
    expect(state.audits).toBe(0)
  })

  it('does not let a rep edit the lines of a Cancelled order', async () => {
    const { client, state } = makeSupabase(cancelledOrder())
    createServerClient.mockReturnValue(client)

    const res = await updateOrder(
      request({ orderId: 55, orderLines: [{ item_id: 1, qty: 2 }] })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/pending/i)
    expect(state.updates).toBe(0)
    expect(state.deletes).toBe(0)
    expect(state.rpcs).toBe(0)
    expect(state.audits).toBe(0)
  })

  it('does not let a rep deliver a Cancelled order', async () => {
    const { client, state } = makeSupabase(cancelledOrder())
    createSupabaseClient.mockReturnValue(client)

    const res = await deliverOrder(
      request({ orderId: 55, deliveredBy: 'rep' })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/posted/i)
    expect(state.rpcs).toBe(0)
    expect(state.updates).toBe(0)
    expect(state.audits).toBe(0)
  })

  it('does not let a rep post a Cancelled order', async () => {
    const { client, state } = makeSupabase(cancelledOrder())
    createSupabaseClient.mockReturnValue(client)

    const res = await postOrder(
      request({ orderId: 55, note: 'retry' })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/pending/i)
    expect(state.rpcs).toBe(0)
    expect(state.updates).toBe(0)
    expect(state.audits).toBe(0)
  })

  it('delivers a Posted order normally', async () => {
    const { client, state } = makeSupabase(
      { ...cancelledOrder(), status: 'Posted' },
      { allowWrites: true }
    )
    createSupabaseClient.mockReturnValue(client)

    const res = await deliverOrder(
      request({ orderId: 55, deliveredBy: 'rep' })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(state.rpcs).toBe(1)
    expect(state.updates).toBe(1)
    expect(state.audits).toBe(1)
  })

  it('posts a Pending order normally', async () => {
    const { client, state } = makeSupabase(
      { ...cancelledOrder(), status: 'Pending' },
      { allowWrites: true }
    )
    createSupabaseClient.mockReturnValue(client)

    const res = await postOrder(
      request({ orderId: 55, note: 'post it' })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(state.rpcs).toBe(1)
    expect(state.updates).toBe(1)
    expect(state.audits).toBe(1)
  })
})
