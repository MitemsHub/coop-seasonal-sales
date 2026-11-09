// app/api/vendor/exhibition/members/search/route.test.js
// Regression: the vendor invoice desk must never receive a member's
// category, grade, loan status, or financial amounts. Only the identity and
// delivery fields needed to raise an invoice may leave this endpoint.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabaseServer', () => ({ createClient: vi.fn() }))
vi.mock('../../../_session', () => ({ getVendorContext: vi.fn() }))

import { GET } from './route'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'

function makeSupabase(rows) {
  const chain = {
    select: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return { from: () => chain }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/vendor/exhibition/members/search privacy', () => {
  it('returns only invoice identity fields, never category, grade, loan status, or financial amounts', async () => {
    getVendorContext.mockResolvedValue({
      vendor_id: 1,
      cycle_id: 2,
      branch_id: 3,
      vendor_code: 'V1',
    })
    createClient.mockReturnValue(
      makeSupabase([
        {
          member_id: 'E00076',
          full_name: 'MITTI EMMANUEL CHUKWUEKU',
          branch_id: 4,
          department_id: 5,
          category: 'E',
          grade: 'Senior Supervisor 1',
          loans: 120000,
          savings: 500000,
          global_limit: 1000000,
          branches: { name: 'Coop Secretariat', code: 'CS' },
          departments: { name: 'Operations' },
        },
      ])
    )

    const res = await GET({
      nextUrl: new URL('http://localhost/api/vendor/exhibition/members/search?q=E00076'),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.members).toHaveLength(1)
    expect(body.members[0]).toEqual({
      member_id: 'E00076',
      full_name: 'MITTI EMMANUEL CHUKWUEKU',
      branch: 'Coop Secretariat',
      branch_code: 'CS',
      department: 'Operations',
    })

    for (const forbidden of [
      'category',
      'grade',
      'has_loan',
      'loans',
      'savings',
      'global_limit',
      'loan_eligible',
      'savings_eligible',
      'outstanding_loans_total',
      'credit_facility',
    ]) {
      expect(body.members[0]).not.toHaveProperty(forbidden)
    }
  })
})
