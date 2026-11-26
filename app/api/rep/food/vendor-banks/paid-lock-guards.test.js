// Focused tests for the Rep food bank/invoice paid-lock guards.
// The route handlers run against a small fake Supabase client; no database or
// storage credentials are needed.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/validation', () => ({ validateSession: vi.fn() }))
vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/cycleResolve', () => ({ resolveFoodCycleId: vi.fn() }))
vi.mock('@/lib/repFoodBankGuard', () => ({ isFoodBankAccountPaid: vi.fn() }))

import { POST as uploadInvoice } from './invoices/upload/route'
import { POST as directUploadInvoice } from '../../../vendor-invoices/direct-upload/route'
import { POST as updateInvoice } from './invoices/update/route'
import { DELETE as deleteInvoice } from './invoices/delete/route'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { resolveFoodCycleId } from '@/lib/cycleResolve'
import { isFoodBankAccountPaid } from '@/lib/repFoodBankGuard'

function makeSupabase({ account = null, invoice = null, paidCycles = [] } = {}) {
  const paid = new Set((paidCycles || []).map(Number))

  return {
    from(table) {
      if (table === 'food_vendor_payment_status') {
        let cycleId = null
        const chain = {
          select: () => chain,
          eq: (column, value) => {
            if (column === 'cycle_id') cycleId = Number(value)
            return chain
          },
          maybeSingle: async () => ({
            data: { is_paid: paid.has(cycleId) },
            error: null,
          }),
        }
        return chain
      }

      if (table === 'food_vendor_bank_accounts') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: account, error: null }),
        }
        return chain
      }

      if (table === 'food_vendor_invoices') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: invoice, error: null }),
          update: () => {
            throw new Error('invoice update must not run when a guard rejects the request')
          },
        }
        return chain
      }

      throw new Error(`Unexpected table in paid-lock test: ${table}`)
    },
  }
}

function uploadRequest(bankAccountId) {
  const form = new Map()
  if (bankAccountId != null) form.set('bank_account_id', String(bankAccountId))
  return { formData: async () => form }
}

function jsonRequest(body) {
  return { json: async () => body }
}

beforeEach(() => {
  vi.clearAllMocks()
  validateSession.mockResolvedValue({
    valid: true,
    tokenType: 'rep',
    claims: { role: 'rep', branch_id: 1, module: 'food', branch_code: 'CALABAR' },
  })
  resolveFoodCycleId.mockResolvedValue(7)
  isFoodBankAccountPaid.mockResolvedValue(false)
})

describe('rep food invoice paid-lock guards', () => {
  it('rejects an ordinary upload to a paid bank account', async () => {
    createClient.mockReturnValue(
      makeSupabase({ account: { id: 9, is_paid: true } })
    )

    const res = await uploadInvoice(uploadRequest(9))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Paid/)
  })

  it('rejects an upload that cannot be assigned to any bank account', async () => {
    createClient.mockReturnValue(makeSupabase({ account: null }))

    const res = await uploadInvoice(uploadRequest(null))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Choose the bank account/)
  })

  it('rejects a direct-upload sign request against a paid bank account', async () => {
    createClient.mockReturnValue(
      makeSupabase({ account: { id: 9, is_paid: true } })
    )

    const res = await directUploadInvoice(
      jsonRequest({
        action: 'sign',
        module: 'food',
        bank_account_id: 9,
        file_name: 'invoice.pdf',
        file_type: 'application/pdf',
        file_size: 100,
      })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Paid/)
  })

  it('rejects a direct upload that has no bank account to attach to', async () => {
    createClient.mockReturnValue(makeSupabase({ account: null }))

    const res = await directUploadInvoice(
      jsonRequest({
        action: 'sign',
        module: 'food',
        file_name: 'invoice.pdf',
        file_type: 'application/pdf',
        file_size: 100,
      })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Choose the bank account/)
  })

  it('rejects edits to an invoice whose bank account is paid', async () => {
    createClient.mockReturnValue(
      makeSupabase({
        invoice: {
          id: 41,
          branch_id: 1,
          cycle_id: 7,
          bank_account_id: 9,
          storage_bucket: 'vendor-invoices',
          storage_path: 'food/1/7/invoice.pdf',
        },
      })
    )
    isFoodBankAccountPaid.mockResolvedValue(true)

    const res = await updateInvoice(jsonRequest({ invoice_id: 41, notes: 'changed' }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Paid/)
    expect(isFoodBankAccountPaid).toHaveBeenCalledWith(expect.anything(), {
      accountId: 9,
      branchId: 1,
    })
  })

  it('rejects detaching an invoice by setting its bank account to null', async () => {
    const res = await updateInvoice(
      jsonRequest({ invoice_id: 41, bank_account_id: null })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Choose the bank account/)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('checks the invoice cycle, not just the active cycle, before editing', async () => {
    createClient.mockReturnValue(
      makeSupabase({
        invoice: {
          id: 41,
          branch_id: 1,
          cycle_id: 6,
          bank_account_id: 9,
          storage_bucket: 'vendor-invoices',
          storage_path: 'food/1/6/invoice.pdf',
        },
        paidCycles: [6],
      })
    )

    const res = await updateInvoice(jsonRequest({ invoice_id: 41, notes: 'changed' }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/cycle is marked as Paid/)
  })

  it('rejects deleting an invoice whose bank account is paid', async () => {
    createClient.mockReturnValue(
      makeSupabase({
        invoice: {
          id: 41,
          branch_id: 1,
          cycle_id: 7,
          bank_account_id: 9,
          storage_bucket: 'vendor-invoices',
          storage_path: 'food/1/7/invoice.pdf',
        },
      })
    )
    isFoodBankAccountPaid.mockResolvedValue(true)

    const res = await deleteInvoice({
      url: 'http://x/api/rep/food/vendor-banks/invoices/delete?invoice_id=41',
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/Paid/)
  })

  it('checks the invoice cycle before deleting an old-cycle invoice', async () => {
    createClient.mockReturnValue(
      makeSupabase({
        invoice: {
          id: 41,
          branch_id: 1,
          cycle_id: 6,
          bank_account_id: 9,
          storage_bucket: 'vendor-invoices',
          storage_path: 'food/1/6/invoice.pdf',
        },
        paidCycles: [6],
      })
    )

    const res = await deleteInvoice({
      url: 'http://x/api/rep/food/vendor-banks/invoices/delete?invoice_id=41',
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/cycle is marked as Paid/)
  })
})
