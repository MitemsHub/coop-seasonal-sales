// app/api/vendor/exhibition/orders/create/route.test.js
// Regression: the vendor create route still enforces Savings eligibility
// server-side, but must not tell the vendor why (no outstanding-loan hint).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/exhibitionAudit', () => ({ logExhibitionAudit: vi.fn() }))
vi.mock('../../../_session', () => ({ getVendorContext: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'

function makeSupabase({ vendor, cycle, member }) {
  return {
    from(table) {
      const response =
        {
          exhibition_vendors: { data: vendor, error: null },
          exhibition_cycles: { data: cycle, error: null },
          members: { data: member, error: null },
        }[table] || { data: null, error: null }
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(response),
      }
      return chain
    },
    rpc: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/vendor/exhibition/orders/create — Savings eligibility', () => {
  it('rejects Savings for a member with a loan without revealing the loan status', async () => {
    getVendorContext.mockResolvedValue({
      vendor_id: 1,
      cycle_id: 2,
      branch_id: 3,
      vendor_code: 'V1',
    })
    createClient.mockReturnValue(
      makeSupabase({
        vendor: { id: 1, name: 'Mitems Foods', branch_id: 3, cycle_id: 2, status: 'active' },
        cycle: {
          id: 2,
          status: 'active',
          starts_at: null,
          ends_at: null,
          loan_interest_rate_pct: 13,
          exh_loan_cap_include_interest: true,
        },
        member: {
          member_id: 'E00076',
          full_name: 'MITTI EMMANUEL CHUKWUEKU',
          portal_enabled: true,
          loans: 120000,
        },
      })
    )

    const res = await POST({
      json: async () => ({
        member_id: 'E00076',
        payment_option: 'Savings',
        items: [{ name: 'TV', qty: 1, price: 1000 }],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('Savings is not available for this member. Choose Cash or Loan.')
    expect(body.error).not.toMatch(/outstanding|balance|credit/i)
  })
})
