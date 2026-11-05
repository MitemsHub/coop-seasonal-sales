// app/api/admin/reports/delivery-location-summary/route.js
// "Summary of Orders from All Delivery Locations" — one row per delivery
// location with the order value including markup and excluding markup, plus the
// markup total. Reads orders/order_lines directly (v_master_sheet goes empty
// when no cycle is flagged active) and resolves the cycle the usual way.
import { NextResponse } from 'next/server'
import { validateSession } from '../../../../../lib/validation'
import { createClient } from '../../../../../lib/supabaseServer'
import { queryDirect } from '../../../../../lib/directDb'
import { resolveFoodCycle } from '../../../../../lib/cycleResolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SQL = `
  SELECT
    b.code AS branch_code,
    b.name AS branch_name,
    COALESCE(SUM(ol.amount), 0)::numeric AS amount_with_markup,
    COALESCE(SUM(ol.qty * (ol.unit_price - COALESCE(mu.amount, 0))), 0)::numeric AS amount_without_markup
  FROM orders o
  JOIN order_lines ol ON ol.order_id = o.order_id
  JOIN branches b ON b.id = o.delivery_branch_id
  LEFT JOIN LATERAL (
    SELECT m.amount
    FROM branch_item_markups m
    WHERE m.branch_id = o.delivery_branch_id
      AND m.item_id = ol.item_id
      AND m.cycle_id = o.cycle_id
      AND m.active
    ORDER BY m.updated_at DESC
    LIMIT 1
  ) mu ON TRUE
  WHERE o.cycle_id = $1
    AND o.status::text IN ('Pending', 'Posted', 'Delivered')
  GROUP BY b.code, b.name
  ORDER BY b.name ASC
`

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient()
    const cycle = await resolveFoodCycle(supabase)
    if (!cycle?.id) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const { rows } = await queryDirect(SQL, [Number(cycle.id)])

    const locations = (rows || []).map((r) => {
      const withMarkup = Number(r.amount_with_markup || 0)
      const withoutMarkup = Number(r.amount_without_markup || 0)
      return {
        branch_code: r.branch_code || '',
        delivery_location: r.branch_name || r.branch_code || '',
        amount_with_markup: withMarkup,
        amount_without_markup: withoutMarkup,
        markup: withMarkup - withoutMarkup,
      }
    })

    const totals = locations.reduce(
      (acc, r) => ({
        amount_with_markup: acc.amount_with_markup + r.amount_with_markup,
        amount_without_markup: acc.amount_without_markup + r.amount_without_markup,
        markup: acc.markup + r.markup,
      }),
      { amount_with_markup: 0, amount_without_markup: 0, markup: 0 }
    )

    return NextResponse.json({
      ok: true,
      cycle: { id: Number(cycle.id), code: cycle.code || '', name: cycle.name || '' },
      rows: locations,
      totals,
    })
  } catch (e) {
    console.error('delivery-location-summary error:', e)
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
