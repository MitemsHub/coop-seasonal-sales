// lib/crossModuleExposure.js
// Cross-module exposure: when multiple products (Food, Exhibition) are
// available, a member's purchases in Food reduce the remaining limit in
// Exhibition and vice-versa.  This utility queries both order tables for
// the ACTIVE CYCLE ONLY (matching the cycle-scoped rule used everywhere
// else — earlier cycles stop counting) and returns the combined exposure.
// RAM is intentionally excluded.  Mirrors the exposure SELECT inside the
// live create_food_order_atomic / check_exhibition_exposure_atomic SQL
// functions, which must be kept in sync.  Food LOAN orders count by principal
// (their order_lines amounts), as in check_exhibition_exposure_atomic: the
// stored total_amount includes distribution interest, which is a repayment
// charge, not borrowed room.

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

  // Scope to the active cycle — earlier cycles stop counting. With no
  // active cycle we fall back to the calendar-year filter (module closed,
  // display-only).
  let activeCycleId = null
  try {
    const { data: cyc, error: cycErr } = await supabase
      .from('cycles')
      .select('id')
      .eq('is_active', true)
      .maybeSingle()
    if (!cycErr) activeCycleId = cyc?.id ?? null
  } catch {}

  // Exhibition runs on its own cycle table (exhibition_cycles), so its orders
  // must be scoped by ITS active cycle. Using the food cycle id here compared
  // against a different id space and matched nothing at all.
  let activeExhibitionCycleIds = []
  try {
    const { data: exhCyc, error: exhCycErr } = await supabase
      .from('exhibition_cycles')
      .select('id')
      .eq('status', 'active')
    if (!exhCycErr) {
      activeExhibitionCycleIds = (exhCyc || [])
        .map((c) => Number(c.id))
        .filter((n) => Number.isFinite(n) && n > 0)
    }
  } catch {}

  // ── Food orders (Pending / Posted / Delivered) ────────────────────────
  let foodQ = supabase
    .from('orders')
    .select('order_id, total_amount, payment_option')
    .eq('member_id', memberId)
    .in('status', ['Pending', 'Posted', 'Delivered'])
  foodQ = activeCycleId != null ? foodQ.eq('cycle_id', activeCycleId) : foodQ.gte('created_at', yearStart)

  // ── Exhibition orders (Pending / Approved / Delivered / Confirmed) ────
  // Confirmed = member acknowledged receipt. It still counts as exposure;
  // dropping it would hand the limit back the moment they confirm.
  let exhQ = supabase
    .from('exhibition_orders')
    .select('total_amount, payment_option')
    .eq('member_id', memberId)
    .in('status', ['Pending', 'Approved', 'Delivered', 'Confirmed'])
  exhQ = activeExhibitionCycleIds.length
    ? exhQ.in('cycle_id', activeExhibitionCycleIds)
    : exhQ.gte('created_at', yearStart)

  const [foodRes, exhRes] = await Promise.all([foodQ, exhQ])

  // Food loan principals. Interest is added to a food order's total_amount at
  // checkout, so the stored total overstates borrowed room; the line amounts
  // are the principal the exhibition function counts.
  const foodPrincipalByOrder = new Map()
  if (!foodRes.error) {
    const loanOrderIds = (foodRes.data || [])
      .filter((r) => r.payment_option === 'Loan')
      .map((r) => r.order_id)
    if (loanOrderIds.length) {
      const { data: lines, error: linesErr } = await supabase
        .from('order_lines')
        .select('order_id, amount')
        .in('order_id', loanOrderIds)
      // Ignore "relation does not exist" (42P01) errors — table may not exist yet
      if (!linesErr) {
        for (const line of lines || []) {
          const id = line.order_id
          foodPrincipalByOrder.set(id, (foodPrincipalByOrder.get(id) || 0) + Number(line.amount || 0))
        }
      }
    }
  }

  let loanExposure = 0
  let savingsExposure = 0

  for (const r of foodRes.error ? [] : foodRes.data || []) {
    const total = Number(r.total_amount || 0)
    // Fall back to the stored total when an order has no readable lines.
    const principal = foodPrincipalByOrder.has(r.order_id) ? foodPrincipalByOrder.get(r.order_id) : total
    if (r.payment_option === 'Loan') loanExposure += principal
    else if (r.payment_option === 'Savings') savingsExposure += total
  }

  // Exhibition orders keep their stored totals; the cycle's own
  // include-interest setting governs them inside the SQL function.
  if (!exhRes.error) {
    for (const r of exhRes.data || []) {
      const amt = Number(r.total_amount || 0)
      if (r.payment_option === 'Loan') loanExposure += amt
      else if (r.payment_option === 'Savings') savingsExposure += amt
    }
  }

  return { loanExposure, savingsExposure }
}
