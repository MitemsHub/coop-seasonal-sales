// app/api/admin/exhibition/orders/reprice/route.js
// POST /api/admin/exhibition/orders/reprice   body: { cycle_id? }
//
// Bringing the season's loan rate (or a product's price/discount) up to date
// only changes what new orders are charged — existing orders keep the numbers
// they were written with. This is the exhibition twin of the food
// price-repricer: it re-reads every still-open order in the season and
// recalculates
//   • each line at the product's current vendor price and approved discount
//     (counter-invoice lines have no product, so their price is left alone)
//   • every order total as principal + loan interest at the season's current
//     loan_interest_rate_pct (Cash and Savings orders carry no interest)
//   • the vendor payable rows that have not been paid yet
//
// Only Pending and Approved orders move: Confirmed, Delivered and Cancelled
// orders are settled history and must not change under a member's feet.
//
// The whole recalculation is one statement, so a reprice is all-or-nothing and
// the pre-update numbers are the ones the WHERE clauses compare against. That
// same statement returns every order that moved, with its before/after totals,
// and each one gets an audit row (action 'Repriced') — a reprice changes money
// on a member's invoice, so it needs the same trail a cancellation gets.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { csrfGuard } from '@/lib/csrf'
import { queryDirect } from '@/lib/directDb'
import { logExhibitionAuditEntries } from '@/lib/exhibitionAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Vendor price stays the list price; the member pays the approved discount.
// Cap at 90% so a bad row can never make a product free by accident.
function unitPriceExpr(hasDiscount) {
  if (!hasDiscount) return 'p.vendor_price::numeric'
  return `GREATEST(0::numeric, ROUND(p.vendor_price::numeric * (100 - LEAST(GREATEST(COALESCE(p.discount_pct, 0), 0), 90)) / 100))`
}

function buildSql(hasDiscount) {
  const unit = unitPriceExpr(hasDiscount)
  return `
    WITH target AS (
      SELECT o.id,
             o.order_id AS order_code,
             o.payment_option,
             o.total_amount AS old_total,
             o.total_qty AS old_qty,
             COALESCE(c.loan_interest_rate_pct, 0)::numeric AS rate
        FROM public.exhibition_orders o
        JOIN public.exhibition_cycles c ON c.id = o.cycle_id
       WHERE o.cycle_id = $1
         AND o.status IN ('Pending', 'Approved')
    ),
    priced AS (
      SELECT l.id AS line_id,
             l.order_id,
             l.vendor_id,
             l.qty::numeric AS qty,
             CASE
               WHEN l.product_id IS NOT NULL AND p.id IS NOT NULL
                 THEN ${unit}
               ELSE l.final_price::numeric
             END AS unit_price
        FROM public.exhibition_order_lines l
        JOIN target t ON t.id = l.order_id
        LEFT JOIN public.exhibition_products p ON p.id = l.product_id
    ),
    updated_lines AS (
      UPDATE public.exhibition_order_lines l
         SET final_price = x.unit_price::bigint,
             amount = (x.unit_price * x.qty)::bigint
        FROM priced x
       WHERE l.id = x.line_id
         AND (l.final_price IS DISTINCT FROM x.unit_price::bigint
              OR l.amount IS DISTINCT FROM (x.unit_price * x.qty)::bigint)
      RETURNING l.order_id
    ),
    totals AS (
      SELECT x.order_id,
             SUM(x.unit_price * x.qty) AS principal,
             SUM(x.qty)::int AS qty
        FROM priced x
       GROUP BY x.order_id
    ),
    updated_orders AS (
      UPDATE public.exhibition_orders o
         SET total_amount = (tot.principal + CASE WHEN o.payment_option = 'Loan'
                                                  THEN ROUND(tot.principal * t.rate / 100)
                                                  ELSE 0 END)::bigint,
             total_qty = tot.qty,
             updated_at = NOW()
        FROM totals tot
        JOIN target t ON t.id = tot.order_id
       WHERE o.id = tot.order_id
         AND (o.total_amount IS DISTINCT FROM (tot.principal + CASE WHEN o.payment_option = 'Loan'
                                                                    THEN ROUND(tot.principal * t.rate / 100)
                                                                    ELSE 0 END)::bigint
              OR o.total_qty IS DISTINCT FROM tot.qty)
      RETURNING o.id
    ),
    updated_payables AS (
      UPDATE public.exhibition_vendor_payment_status v
         SET amount = pay.amount
        FROM (
          SELECT x.order_id,
                 x.vendor_id,
                 SUM(x.unit_price * x.qty)::bigint AS amount
            FROM priced x
           GROUP BY x.order_id, x.vendor_id
        ) pay
       WHERE v.order_id = pay.order_id
         AND v.vendor_id = pay.vendor_id
         AND v.paid = FALSE
         AND v.amount IS DISTINCT FROM pay.amount
      RETURNING v.id
    ),
    affected AS (
      SELECT u.id AS order_id FROM updated_orders u
      UNION
      SELECT ul.order_id FROM updated_lines ul
    ),
    changes AS (
      SELECT a.order_id AS id,
             t.order_code,
             t.payment_option,
             t.old_total,
             t.old_qty,
             tot.qty AS new_qty,
             (tot.principal + CASE WHEN t.payment_option = 'Loan'
                                   THEN ROUND(tot.principal * t.rate / 100)
                                   ELSE 0 END)::bigint AS new_total,
             (SELECT COUNT(*)::int FROM updated_lines ul WHERE ul.order_id = a.order_id) AS changed_lines
        FROM affected a
        JOIN target t ON t.id = a.order_id
        JOIN totals tot ON tot.order_id = a.order_id
    )
    SELECT (SELECT COUNT(*)::int FROM totals) AS scanned_orders,
           (SELECT COUNT(*)::int FROM updated_orders) AS updated_orders,
           (SELECT COUNT(*)::int FROM updated_lines) AS updated_lines,
           (SELECT COUNT(*)::int FROM updated_payables) AS updated_payables,
           COALESCE((SELECT json_agg(changes ORDER BY id) FROM changes), '[]'::json) AS changed;
  `
}

const money = (n) => Number(n || 0).toLocaleString('en-NG')

export async function POST(request) {
  const csrfResponse = csrfGuard(request)
  if (csrfResponse) return csrfResponse

  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const supabase = createClient()

    let cycleId = Number(body.cycle_id)
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      const { data: active, error: activeErr } = await supabase
        .from('exhibition_cycles')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .maybeSingle()
      if (activeErr) return NextResponse.json({ ok: false, error: 'Failed to find the active season' }, { status: 500 })
      if (!active?.id) return NextResponse.json({ ok: false, error: 'Create or activate an exhibition season first.' }, { status: 400 })
      cycleId = Number(active.id)
    }

    const { data: cycle, error: cycErr } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, loan_interest_rate_pct')
      .eq('id', cycleId)
      .maybeSingle()
    if (cycErr) return NextResponse.json({ ok: false, error: cycErr.message }, { status: 500 })
    if (!cycle) return NextResponse.json({ ok: false, error: 'Exhibition season not found' }, { status: 404 })

    // discount_pct arrived with its own migration; a season that has not had it
    // applied is repriced without a discount rather than failing outright.
    let hasDiscount = true
    try {
      const col = await queryDirect(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'exhibition_products' AND column_name = 'discount_pct'`
      )
      hasDiscount = (col?.rows?.length || 0) > 0
    } catch {
      hasDiscount = false
    }

    const result = await queryDirect(buildSql(hasDiscount), [cycleId])
    const row = result?.rows?.[0] || {}
    const scanned = Number(row.scanned_orders || 0)
    const updatedOrders = Number(row.updated_orders || 0)
    const updatedLines = Number(row.updated_lines || 0)
    const updatedPayables = Number(row.updated_payables || 0)
    const ratePct = Number(cycle.loan_interest_rate_pct || 0)

    // One audit row per order that actually moved, carrying its own numbers so
    // "who repriced what and when" is answerable from the trail alone.
    const changed = Array.isArray(row.changed) ? row.changed : []
    const entries = changed.map((c) => ({
      orderId: Number(c.id),
      cycleId,
      action: 'Repriced',
      actorType: 'admin',
      actorLabel: 'System admin',
      note:
        `${cycle.code || cycle.name} at ${ratePct}% loan interest: total NGN ${money(c.old_total)} → ${money(c.new_total)}` +
        `${Number(c.changed_lines || 0) ? `, ${Number(c.changed_lines)} line(s) repriced` : ''}.`,
      detail: {
        cycle_id: cycleId,
        cycle_code: cycle.code || '',
        loan_interest_rate_pct: ratePct,
        old_total: Number(c.old_total || 0),
        new_total: Number(c.new_total || 0),
        total_delta: Number(c.new_total || 0) - Number(c.old_total || 0),
        old_qty: Number(c.old_qty || 0),
        new_qty: Number(c.new_qty || 0),
        changed_lines: Number(c.changed_lines || 0),
      },
    }))
    if (entries.length) await logExhibitionAuditEntries(entries)

    return NextResponse.json({
      ok: true,
      cycle_id: cycleId,
      cycle_name: cycle.name,
      cycle_code: cycle.code,
      loan_interest_rate_pct: ratePct,
      discount_applied: hasDiscount,
      scanned_orders: scanned,
      updated_orders: updatedOrders,
      updated_lines: updatedLines,
      updated_payables: updatedPayables,
      audited_orders: entries.length,
    })
  } catch (error) {
    console.error('Error repricing exhibition orders:', error)
    return NextResponse.json({ ok: false, error: error.message || 'Failed to reprice orders' }, { status: 500 })
  }
}
