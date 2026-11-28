// lib/crossModuleExposure.js
// Cross-module exposure: when multiple products (Food, Exhibition) are
// available, a member's purchases in Food reduce the remaining limit in
// Exhibition and vice-versa.  This utility queries both order tables and
// returns the combined exposure. RAM is intentionally excluded.
//
// Which food counts is decided by the year of its DISTRIBUTION, not the year
// the row was written: a 2025 cycle delivered in January is 2025 food, and its
// loan is already on the member's balance, so counting it again would charge
// them twice for the same bag. The distribution's year comes from the cycle
// name when it carries one, otherwise from when the cycle was created — the
// same rule check_exhibition_exposure_atomic and the Checker use.
//
// Food LOAN orders count by principal (their order_lines amounts), as in
// check_exhibition_exposure_atomic: the stored total_amount includes
// distribution interest, which is a repayment charge, not borrowed room.

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

  // Exhibition runs on its own cycle table (exhibition_cycles), so its orders
  // must be scoped by ITS active cycle. Using the food cycle id here compared
  // against a different id space and matched nothing at all.
  let activeExhibitionCycleIds = []
  // Whether a season's room is consumed at goods value or at the repayable
  // total: the cycle's own setting, exactly as the SQL function decides it.
  const exhibitionIncludeInterest = new Map()
  // The season's calendar year decides which food belongs to it.
  let seasonYear = new Date().getFullYear()
  try {
    const { data: exhCyc, error: exhCycErr } = await supabase
      .from('exhibition_cycles')
      .select('id, starts_at, exh_loan_cap_include_interest')
      .eq('status', 'active')
    if (!exhCycErr) {
      activeExhibitionCycleIds = (exhCyc || [])
        .map((c) => Number(c.id))
        .filter((n) => Number.isFinite(n) && n > 0)
      for (const c of exhCyc || []) {
        exhibitionIncludeInterest.set(Number(c.id), c.exh_loan_cap_include_interest !== false)
      }
      const startsYear = Number(String((exhCyc || []).find((c) => c.starts_at)?.starts_at || '').slice(0, 4))
      if (startsYear) seasonYear = startsYear
    }
  } catch {}

  // Distribution year per food cycle, read once.
  const cycleYearById = new Map()
  try {
    const { data: cycles } = await supabase.from('cycles').select('id, name, created_at')
    for (const c of cycles || []) {
      const named = String(c.name || '').match(/(?:19|20)\d{2}/)
      const year = named ? Number(named[0]) : Number(String(c.created_at || '').slice(0, 4)) || 0
      cycleYearById.set(Number(c.id), year)
    }
  } catch {}

  // ── Food orders (Pending / Posted / Delivered) ────────────────────────
  // Read them all and keep the season's own distribution below; a created-at
  // window would sweep in last season's orders delivered after New Year.
  const foodQ = supabase
    .from('orders')
    .select('order_id, cycle_id, created_at, total_amount, payment_option')
    .eq('member_id', memberId)
    .in('status', ['Pending', 'Posted', 'Delivered'])

  // ── Exhibition orders (Pending / Approved / Delivered / Confirmed) ────
  // Confirmed = member acknowledged receipt. It still counts as exposure;
  // dropping it would hand the limit back the moment they confirm.
  let exhQ = supabase
    .from('exhibition_orders')
    .select('id, cycle_id, total_amount, payment_option')
    .eq('member_id', memberId)
    .in('status', ['Pending', 'Approved', 'Delivered', 'Confirmed'])
  exhQ = activeExhibitionCycleIds.length
    ? exhQ.in('cycle_id', activeExhibitionCycleIds)
    : exhQ.gte('created_at', yearStart)

  // Goods value per exhibition order, for seasons that measure room at goods.
  const exhibitionGoodsById = new Map()

  const [foodRes, exhRes] = await Promise.all([foodQ, exhQ])

  const exhRows = exhRes.error ? [] : exhRes.data || []
  if (exhRows.some((r) => exhibitionIncludeInterest.get(Number(r.cycle_id)) === false)) {
    const { data: lines, error: linesErr } = await supabase
      .from('exhibition_order_lines')
      .select('order_id, amount')
      .in('order_id', exhRows.map((r) => r.id))
    if (!linesErr) {
      for (const line of lines || []) {
        exhibitionGoodsById.set(line.order_id, (exhibitionGoodsById.get(line.order_id) || 0) + Number(line.amount || 0))
      }
    }
  }

  // This season's food: the distribution's year has to be the season's year.
  const foodRows = (foodRes.error ? [] : foodRes.data || []).filter((r) => {
    const cycleYear = cycleYearById.get(Number(r.cycle_id))
    const year = cycleYear || Number(String(r.created_at || '').slice(0, 4)) || 0
    return year === seasonYear
  })

  // Food loan principals. Interest is added to a food order's total_amount at
  // checkout, so the stored total overstates borrowed room; the line amounts
  // are the principal the exhibition function counts.
  const foodPrincipalByOrder = new Map()
  if (foodRows.length) {
    const loanOrderIds = foodRows
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

  for (const r of foodRows) {
    const total = Number(r.total_amount || 0)
    // Fall back to the stored total when an order has no readable lines.
    const principal = foodPrincipalByOrder.has(r.order_id) ? foodPrincipalByOrder.get(r.order_id) : total
    if (r.payment_option === 'Loan') loanExposure += principal
    else if (r.payment_option === 'Savings') savingsExposure += total
  }

  // Exhibition orders: the cycle's include-interest setting decides whether the
  // stored total or the goods principal consumed the room.
  for (const r of exhRows) {
    const goods = exhibitionGoodsById.get(r.id)
    const amt = exhibitionIncludeInterest.get(Number(r.cycle_id)) === false && goods
      ? goods
      : Number(r.total_amount || 0)
    if (r.payment_option === 'Loan') loanExposure += amt
    else if (r.payment_option === 'Savings') savingsExposure += amt
  }

  return { loanExposure, savingsExposure }
}
