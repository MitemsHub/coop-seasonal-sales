// Focused tests for Rep food bank-account mutation and add guards.
// The shared guard module is mocked so these tests exercise the route-level
// paid checks without a database.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/repFoodBankGuard', () => ({
  FOOD_BANK_SELECT: 'id,branch_id,cycle_id,bank_name,account_name,account_number,is_current,is_paid',
  MAX_FOOD_BANK_ACCOUNTS: 10,
  cleanText: (value, maxLength = 120) =>
    String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength),
  isMissingTable: () => false,
  loadRepFoodWriteContext: vi.fn(),
  normalizeAccountNumber: (value) =>
    String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  isFoodBankAccountPaid: vi.fn(),
}))

import { POST as updateAccount } from './accounts/update/route'
import { POST as deleteAccount } from './accounts/delete/route'
import { POST as addAccount } from './accounts/add/route'
import { POST as setAccount } from './set-account/route'
import { loadRepFoodWriteContext } from '@/lib/repFoodBankGuard'

function makeSupabase({
  rows = [],
  row = null,
  updateResult = null,
  deleteResult = [],
} = {}) {
  const state = { inserted: 0, updated: 0, deleted: 0, cleared: 0 }

  const from = (table) => {
    if (table !== 'food_vendor_bank_accounts') {
      throw new Error(`Unexpected table in account guard test: ${table}`)
    }

    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve, reject) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      insert: (payload) => {
        state.inserted += 1
        return {
          select: () => ({
            single: async () => ({
              data: { ...payload, id: 99, is_paid: false, paid_at: null },
              error: null,
            }),
          }),
        }
      },
      update: () => {
        state.updated += 1
        const chain = {
          eq: (column, value) => {
            if (column === 'is_current' && value === true) state.cleared += 1
            return chain
          },
          select: () => ({
            maybeSingle: async () => updateResult ?? { data: null, error: null },
          }),
        }
        return chain
      },
      delete: () => {
        state.deleted += 1
        const chain = {
          eq: () => chain,
          select: async () => deleteResult ?? { data: [], error: null },
        }
        return chain
      },
    }
    return query
  }

  return { client: { from }, state }
}

function jsonRequest(body) {
  return { json: async () => body }
}

function contextFor(client) {
  return {
    supabase: client,
    branchId: 1,
    cycleId: 7,
    createdByCode: 'CALABAR',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rep food bank-account paid locks', () => {
  it('rejects editing a bank account already marked Paid', async () => {
    const { client, state } = makeSupabase({
      row: { id: 5, account_number: '123', is_current: false, is_paid: true },
    })
    loadRepFoodWriteContext.mockReturnValue(contextFor(client))

    const res = await updateAccount(
      jsonRequest({ account_id: 5, bank_name: 'Changed Bank' })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Paid/)
    expect(state.updated).toBe(0)
  })

  it('rejects an edit when the account becomes Paid between read and write', async () => {
    const { client, state } = makeSupabase({
      row: { id: 5, account_number: '123', is_current: false, is_paid: false },
      updateResult: { data: null, error: null },
    })
    loadRepFoodWriteContext.mockReturnValue(contextFor(client))

    const res = await updateAccount(
      jsonRequest({ account_id: 5, bank_name: 'Changed Bank' })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Paid/)
    expect(state.updated).toBe(1)
  })

  it('rejects deleting a bank account marked Paid', async () => {
    const { client, state } = makeSupabase({
      row: { id: 5, account_number: '123', is_current: false, is_paid: true },
    })
    loadRepFoodWriteContext.mockReturnValue(contextFor(client))

    const res = await deleteAccount(jsonRequest({ account_id: 5 }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Paid/)
    expect(state.deleted).toBe(0)
  })

  it('rejects a delete when the account becomes Paid between read and delete', async () => {
    const { client, state } = makeSupabase({
      row: { id: 5, account_number: '123', is_current: false, is_paid: false },
      deleteResult: { data: [], error: null },
    })
    loadRepFoodWriteContext.mockReturnValue(contextFor(client))

    const res = await deleteAccount(jsonRequest({ account_id: 5 }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/could not be removed/)
    expect(state.deleted).toBe(1)
  })
})

describe('rep food bank-account add locks', () => {
  it('allows adding an account when every existing account is Paid', async () => {
    const { client, state } = makeSupabase({
      rows: [
        { id: 1, account_number: '111', is_current: false, is_paid: true },
        { id: 2, account_number: '222', is_current: false, is_paid: true },
      ],
    })
    loadRepFoodWriteContext.mockReturnValue(contextFor(client))

    const res = await addAccount(
      jsonRequest({
        bank_name: 'First Bank',
        account_name: 'Rep One',
        account_number: '3333333333',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(state.inserted).toBe(1)
  })

  it('still blocks adding an account when the branch itself is marked Paid', async () => {
    const { client, state } = makeSupabase({
      rows: [{ id: 1, account_number: '111', is_current: false, is_paid: false }],
    })
    loadRepFoodWriteContext.mockReturnValue({
      response: Response.json(
        { ok: false, error: 'Branch is marked as Paid. Editing is locked.' },
        { status: 403 }
      ),
    })

    const res = await addAccount(
      jsonRequest({
        bank_name: 'First Bank',
        account_name: 'Rep One',
        account_number: '3333333333',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Branch is marked as Paid/)
    expect(state.inserted).toBe(0)
    expect(client).toBeTruthy()
  })

  it('still allows adding an account while another account is unpaid', async () => {
    const { client, state } = makeSupabase({
      rows: [
        { id: 1, account_number: '111', is_current: false, is_paid: true },
        { id: 2, account_number: '222', is_current: false, is_paid: false },
      ],
    })
    loadRepFoodWriteContext.mockReturnValue(contextFor(client))

    const res = await addAccount(
      jsonRequest({
        bank_name: 'First Bank',
        account_name: 'Rep One',
        account_number: '3333333333',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(state.inserted).toBe(1)
  })

  it('blocks the legacy set-account route when any account is Paid', async () => {
    const { client, state } = makeSupabase({
      rows: [
        { id: 1, account_number: '111', is_current: true, is_paid: true },
        { id: 2, account_number: '222', is_current: false, is_paid: false },
      ],
    })
    loadRepFoodWriteContext.mockReturnValue(contextFor(client))

    const res = await setAccount(
      jsonRequest({
        bank_name: 'First Bank',
        account_name: 'Rep One',
        account_number: '3333333333',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/Paid/)
    expect(state.inserted).toBe(0)
    expect(state.cleared).toBe(0)
  })
})
