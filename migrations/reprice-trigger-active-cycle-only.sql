-- Migration: make the price/markup reprice TRIGGER touch the active cycle only,
-- and recompute Loan totals with that cycle's own interest rate.
--
-- Two defects in the live function (verified 2026-10-30):
--
--   1. CLOSED CYCLES WERE REWRITABLE. The trigger
--      trg_reprice_orders_on_bip_change (AFTER INSERT OR UPDATE OF price) and
--      trg_reprice_orders_on_bim_change call reprice_orders_for_branch_item,
--      which rewrote order_lines + orders.total_amount for every
--      Pending/Posted/Delivered order at the branch containing that item.
--      Editing an OLD cycle's price row therefore rewrote historical receipts
--      (line prices, branch_item_price_id and the order total).
--
--   2. HARD-CODED 13% INTEREST. Totals were recomputed as
--      principal + ROUND(principal * 0.13) regardless of the cycle rate.
--      Cycle 2026Q3 runs at 11.5%, so every triggered reprice inflated the
--      affected Loan orders by 1.5% of principal. Measured live: order 1361
--      (Cancelled, so the REPRICE ORDERS button skips it) stores 13% interest
--      — ₦46,635 instead of ₦41,254, an overstatement of ₦5,381.
--      migrations/fix-reprice-orders-for-branch-item-use-cycle-loan-rate.sql
--      fixed the rate but the older definition is what is live today.
--
-- Behaviour after this migration:
--   • price/markup edits still reprice THIS cycle's in-flight orders (the
--     normal admin flow is unchanged),
--   • closed cycles are never touched — their lines and totals are frozen,
--   • Loan totals use cycles.food_loan_interest_rate_pct (13% only as the
--     fallback for deployments without that column).
--
-- Requires: cycles.food_loan_interest_rate_pct, branch_item_prices.cycle_id,
-- orders.cycle_id, branch_item_markups.cycle_id — all present on this
-- deployment.
--
-- APPLY: Supabase SQL Editor (idempotent; the trigger definitions themselves
-- do not change).
BEGIN;

CREATE OR REPLACE FUNCTION public.reprice_orders_for_branch_item(
  p_branch_id BIGINT,
  p_item_id BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  updated_lines_count INTEGER := 0;
  rates_has_cycle BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'cycles'
       AND column_name  = 'food_loan_interest_rate_pct'
  ) INTO rates_has_cycle;

  -- ── 1. Lines: ACTIVE cycle orders only, priced from that order's own cycle ──
  UPDATE public.order_lines AS ol
     SET unit_price = bip.price + COALESCE((
           SELECT bim.amount
             FROM public.branch_item_markups bim
            WHERE bim.branch_id = o.delivery_branch_id
              AND bim.item_id   = ol.item_id
              AND bim.active    = TRUE
              AND bim.cycle_id  = o.cycle_id
         ), 0),
         branch_item_price_id = bip.id,
         amount = (bip.price + COALESCE((
           SELECT bim.amount
             FROM public.branch_item_markups bim
            WHERE bim.branch_id = o.delivery_branch_id
              AND bim.item_id   = ol.item_id
              AND bim.active    = TRUE
              AND bim.cycle_id  = o.cycle_id
         ), 0)) * ol.qty
    FROM public.orders AS o
    JOIN public.cycles AS cy
      ON cy.id = o.cycle_id
     AND cy.is_active = TRUE                       -- ← history is off-limits
    JOIN public.branch_item_prices AS bip
      ON bip.branch_id = o.delivery_branch_id
     AND bip.cycle_id  = o.cycle_id
   WHERE ol.order_id   = o.order_id
     AND bip.item_id   = ol.item_id
     AND o.delivery_branch_id = p_branch_id
     AND ol.item_id    = p_item_id
     AND o.status::text IN ('Pending', 'Posted', 'Delivered');

  GET DIAGNOSTICS updated_lines_count = ROW_COUNT;

  -- ── 2. Totals: same scope, interest at the ORDER'S cycle rate ──────────────
  IF rates_has_cycle THEN
    WITH s AS (
      SELECT ol.order_id, SUM(ol.amount) AS principal
        FROM public.order_lines AS ol
       GROUP BY ol.order_id
    )
    UPDATE public.orders AS o
       SET total_amount = COALESCE(s.principal, 0)
                        + CASE WHEN o.payment_option = 'Loan'
                               THEN ROUND(
                                     COALESCE(s.principal, 0)
                                     * COALESCE(
                                         (SELECT c.food_loan_interest_rate_pct
                                            FROM public.cycles c
                                           WHERE c.id = o.cycle_id),
                                         13) / 100.0)
                               ELSE 0
                          END,
           updated_at = NOW()
      FROM s
     WHERE s.order_id = o.order_id
       AND o.delivery_branch_id = p_branch_id
       AND o.status::text IN ('Pending', 'Posted', 'Delivered')
       AND EXISTS (
             SELECT 1 FROM public.order_lines AS ol2
              WHERE ol2.order_id = o.order_id
                AND ol2.item_id = p_item_id
           )
       AND EXISTS (
             SELECT 1 FROM public.cycles AS cy2
              WHERE cy2.id = o.cycle_id
                AND cy2.is_active = TRUE
           );
  ELSE
    WITH s AS (
      SELECT ol.order_id, SUM(ol.amount) AS principal
        FROM public.order_lines AS ol
       GROUP BY ol.order_id
    )
    UPDATE public.orders AS o
       SET total_amount = COALESCE(s.principal, 0)
                        + CASE WHEN o.payment_option = 'Loan'
                               THEN ROUND(COALESCE(s.principal, 0) * 0.13)
                               ELSE 0
                          END,
           updated_at = NOW()
      FROM s
     WHERE s.order_id = o.order_id
       AND o.delivery_branch_id = p_branch_id
       AND o.status::text IN ('Pending', 'Posted', 'Delivered')
       AND EXISTS (
             SELECT 1 FROM public.order_lines AS ol2
              WHERE ol2.order_id = o.order_id
                AND ol2.item_id = p_item_id
           );
  END IF;

  RETURN json_build_object('success', true, 'updated_lines', updated_lines_count);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

ALTER FUNCTION public.reprice_orders_for_branch_item(BIGINT, BIGINT) SET search_path = public;

COMMENT ON FUNCTION public.reprice_orders_for_branch_item(BIGINT, BIGINT) IS
  'Trigger-driven reprice: active-cycle orders only, Loan interest at the order cycle rate (was: any cycle, hard-coded 13%).';

COMMIT;
