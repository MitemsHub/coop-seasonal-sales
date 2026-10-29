import { createClient } from '../../../../../lib/supabaseServer'
import { validateSession } from '../../../../../lib/validation'
import { csrfGuard } from '../../../../../lib/csrf'
import { queryDirect } from '../../../../../lib/directDb'
 
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
 
export async function POST(request) {
  const csrfResponse = csrfGuard(request)
  if (csrfResponse) return csrfResponse
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
 
    const supabase = createClient()
    const body = await request.json().catch(() => ({}))
 
    const hasColumn = async (table, column) => {
      const { error } = await supabase.from(table).select(column).limit(1)
      return !error
    }
 
    const [ordersHasCycle, pricesHasCycle, markupsHasCycle] = await Promise.all([
      hasColumn('orders', 'cycle_id'),
      hasColumn('branch_item_prices', 'cycle_id'),
      hasColumn('branch_item_markups', 'cycle_id')
    ])
 
    let cycleId = body.cycle_id != null ? Number(body.cycle_id) : null
    if (cycleId != null && !Number.isFinite(cycleId)) {
      return Response.json({ ok: false, error: 'Invalid cycle_id' }, { status: 400 })
    }
 
    if (!cycleId && (ordersHasCycle || pricesHasCycle)) {
      const { data: active, error: activeErr } = await supabase
        .from('cycles')
        .select('id')
        .eq('is_active', true)
        .maybeSingle()
      if (activeErr) return Response.json({ ok: false, error: 'Failed to fetch active cycle' }, { status: 500 })
      if (!active?.id) return Response.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
      cycleId = active.id
    }
 
    const cycleJoin = ordersHasCycle && pricesHasCycle ? 'AND bip.cycle_id = o.cycle_id' : ''
    const markupCycleJoin = ordersHasCycle && markupsHasCycle ? 'AND bim.cycle_id = o.cycle_id' : ''
    const cycleFilter = ordersHasCycle && cycleId ? 'AND o.cycle_id = $1' : ''
    let ratePct = 13
    try {
      const { data: rRow, error: rErr } = await supabase
        .from('cycles')
        .select('food_loan_interest_rate_pct')
        .eq('id', cycleId)
        .maybeSingle()
      if (!rErr && rRow && rRow.food_loan_interest_rate_pct != null) {
        ratePct = Math.max(0, Number(rRow.food_loan_interest_rate_pct || 0))
      }
    } catch {}
    const rateDecimal = Math.max(0, Number(ratePct || 0)) / 100
    const rateParam = ordersHasCycle && cycleId ? '$2' : '$1'
    const params = ordersHasCycle && cycleId ? [cycleId, rateDecimal] : [rateDecimal]
 
    // The UPDATE target (ol) may only be referenced in SET/WHERE/RETURNING —
    // matching it inside the JOIN's ON clause raised
    // "invalid reference to FROM-clause entry for table ol" (42P01) and failed
    // every reprice. The markup is therefore a scalar subquery, the same shape
    // as migrations/fix-reprice-orders-for-branch-item-use-cycle-loan-rate.sql.
    const sql = `
      WITH updated_lines AS (
        UPDATE public.order_lines ol
        SET
          unit_price = bip.price + COALESCE((
                SELECT bim.amount FROM public.branch_item_markups bim
                WHERE bim.branch_id = o.delivery_branch_id
                  AND bim.item_id = ol.item_id
                  AND bim.active = TRUE
                  ${markupCycleJoin}
              ), 0),
          branch_item_price_id = bip.id,
          amount = (bip.price + COALESCE((
                SELECT bim.amount FROM public.branch_item_markups bim
                WHERE bim.branch_id = o.delivery_branch_id
                  AND bim.item_id = ol.item_id
                  AND bim.active = TRUE
                  ${markupCycleJoin}
              ), 0)) * ol.qty
        FROM public.orders o
        JOIN public.branch_item_prices bip
          ON bip.branch_id = o.delivery_branch_id
         ${cycleJoin}
        WHERE ol.order_id = o.order_id
          AND bip.item_id = ol.item_id
          AND o.status::text IN ('Pending','Posted','Delivered')
          ${cycleFilter}
        RETURNING ol.order_id, ol.amount
      ),
      totals AS (
        SELECT order_id, COALESCE(SUM(amount), 0)::numeric AS base_total
        FROM updated_lines
        GROUP BY order_id
      ),
      updated_orders AS (
        UPDATE public.orders o
        SET
          total_amount = CASE
            WHEN o.payment_option = 'Loan' THEN (t.base_total + ROUND(t.base_total * ${rateParam}))
            ELSE t.base_total
          END,
          updated_at = NOW()
        FROM totals t
        WHERE o.order_id = t.order_id
        RETURNING o.order_id
      )
      SELECT
        (SELECT COUNT(*)::int FROM updated_lines) AS updated_lines,
        (SELECT COUNT(*)::int FROM updated_orders) AS updated_orders;
    `
 
    const result = await queryDirect(sql, params)
    const row = result?.rows?.[0] || {}
 
    return Response.json({
      ok: true,
      cycle_id: cycleId ?? null,
      updated_lines: Number(row.updated_lines || 0),
      updated_orders: Number(row.updated_orders || 0)
    })
  } catch (error) {
    console.error('Error in reprice-orders:', error)
    return Response.json({ ok: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
