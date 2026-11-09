// app/components/CounterInvoiceModal.admin.test.jsx
// Regression: the admin invoice desk must keep the member's category/grade
// and the full financial-standing panel (savings, loans, remaining credit,
// outstanding exposure) available after the vendor-side privacy changes.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CounterInvoiceModal from './CounterInvoiceModal'

const ok = (body) => Promise.resolve({ ok: true, json: async () => body })

function mockFetch() {
  const fetchMock = vi.fn((url) => {
    const target = String(url)
    if (target.includes('/api/exhibition/availability')) {
      return ok({ ok: true, cycle: { loan_interest_rate_pct: 13 } })
    }
    if (target.includes('/api/admin/exhibition/members/search')) {
      return ok({
        ok: true,
        members: [
          {
            member_id: 'E00076',
            full_name: 'MITTI EMMANUEL CHUKWUEKU',
            branch: 'Coop Secretariat',
            department: 'Operations',
            category: 'E',
            grade: 'Senior Supervisor 1',
            has_loan: true,
          },
        ],
      })
    }
    if (target.includes('/api/admin/exhibition/members/financials')) {
      return ok({
        ok: true,
        cycle: { name: 'COOP EXHIBITION 2026' },
        financials: {
          savings: 500000,
          loans: 120000,
          loan_eligible: 300000,
          outstanding_loans_total: 120000,
          savings_eligible: 250000,
          warning: '',
        },
      })
    }
    return ok({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CounterInvoiceModal — admin invoice desk', () => {
  it('shows the admin member role and full financial-standing panel after selecting a member', async () => {
    const fetchMock = mockFetch()

    render(<CounterInvoiceModal open onClose={() => {}} mode="admin" />)

    fireEvent.change(screen.getByLabelText('Search member'), { target: { value: 'E00076' } })

    const result = await screen.findByRole('button', { name: /MITTI EMMANUEL CHUKWUEKU/i }, { timeout: 2500 })
    fireEvent.click(result)

    expect(await screen.findByText('Coop Staff · Senior Supervisor 1')).toBeTruthy()
    expect(await screen.findByText('Financial standing')).toBeTruthy()
    expect(await screen.findByText('Remaining credit facility')).toBeTruthy()
    expect(await screen.findByText('Cycle: COOP EXHIBITION 2026')).toBeTruthy()

    expect(screen.getByText('NGN 500,000')).toBeTruthy()
    expect(screen.getByText('NGN 300,000')).toBeTruthy()
    expect(screen.getAllByText('NGN 120,000').length).toBeGreaterThan(0)
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent.includes('Outstanding loans incl. shopping exposure: NGN 120,000') &&
          element.textContent.includes('50% Savings available: NGN 250,000')
      )
    ).toBeTruthy()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/exhibition/members/search?q=E00076'),
      expect.anything()
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/exhibition/members/financials?member_id=E00076'),
      expect.anything()
    )
  })
})
