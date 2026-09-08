// lib/crossModuleExposure.js
// Cross-module exposure: when multiple products (Food, Exhibition) run
// in the same calendar year, a member's purchases in Food reduce the
// remaining limit in Exhibition and vice-versa.  This utility queries both
// order tables for the current calendar year and returns the combined
// exposure.  RAM is intentionally excluded.

export const runtime = 'nodejs'

/**
 * Return { loanExposure, savingsExposure } for `memberId` across Food and
 * Exhibition orders placed in the current calendar year.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase – service-role client
 * @param {string} memberId
 * @returns {Promise<{ loanExposure: number, savingsExposure: number }>}
 */
export async function getCrossModuleExposure(supabase, memberId) {
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()

  // ── Food orders (Pending / Posted / Delivered) ────────────────────────
  const foodQ = supabase
    .from('orders')
    .select('total_amount, payment_option')
    .eq('member_id', memberId)
    .in('status', ['Pending', 'Posted', 'Delivered'])
    .gte('created_at', yearStart)

  // ── Exhibition orders (Pending / Approved / Delivered) ────────────────
  const exhQ = supabase
    .from('exhibition_orders')
    .select('total_amount, payment_option')
    .eq('member_id', memberId)
    .in('status', ['Pending', 'Approved', 'Delivered'])
    .gte('created_at', yearStart)

  const [foodRes, exhRes] = await Promise.all([foodQ, exhQ])

  let loanExposure = 0
  let savingsExposure = 0

  const sumByPayment = (rows, amountKey = 'total_amount') => {
    for (const r of rows || []) {
      const amt = Number(r[amountKey] || 0)
      if (r.payment_option === 'Loan') loanExposure += amt
      else if (r.payment_option === 'Savings') savingsExposure += amt
    }
  }

  // Ignore "relation does not exist" (42P01) errors — table may not exist yet
  if (!foodRes.error) sumByPayment(foodRes.data)
  if (!exhRes.error) sumByPayment(exhRes.data)

  return { loanExposure, savingsExposure }
}
