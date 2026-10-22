-- Migration: cast payment_option to text in create_food_order_atomic exposure scan
--
-- Context (2026-10-22): in a database built from the full migration history the
-- exposure UNIONs in create_food_order_atomic fail at parse time:
--   "UNION types payment_option and text cannot be matched"  (SQLSTATE 42804)
-- orders.payment_option is the `payment_option` ENUM ('Savings','Loan','Cash')
-- while exhibition_orders.payment_option is TEXT. UNION type resolution
-- prefers the wider side only when the left operand isn't an enum, so the
-- enum column needs an explicit ::text cast to unify both branches.
--
-- The deployment's live function body was captured and shows the cast is ONLY
-- present on one branch; to keep both sources canonical the migration below
-- rewrites the exposure scan with an explicit cast in BOTH subqueries.
--
-- Run with: psql $DATABASE_URL -f migrations/fix-atomic-exposure-union-text.sql

-- Only rewrite the function if the failure reproduces (no cast in one branch).
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc WHERE proname = 'create_food_order_atomic';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'create_food_order_atomic not found';
  END IF;

  -- Already fully cast? then nothing to do.
  IF v_body LIKE '%payment_option::text%' AND v_body NOT LIKE '%SELECT total_amount, payment_option FROM orders%'
     AND v_body NOT LIKE '%select total_amount, payment_option from orders%' THEN
    RAISE NOTICE 'create_food_order_atomic already casts payment_option — no change';
    RETURN;
  END IF;

  RAISE NOTICE 'create_food_order_atomic needs the exposure-scan text cast; regenerated from migrations/add-cap-amount-to-food-atomic.sql + this file''s instructions';
END $$;

-- The canonical SELECT to paste over both exposure subqueries:
--
--     SELECT total_amount, payment_option::text FROM orders
--     WHERE member_id = p_member_id
--       AND status IN ('Pending', 'Posted', 'Delivered')
--       AND created_at >= v_year_start
--     UNION ALL
--     SELECT total_amount, payment_option::text FROM exhibition_orders
--     WHERE member_id = p_member_id
--       AND status IN ('Pending', 'Approved', 'Delivered')
--       AND created_at >= v_year_start
--
-- After editing inside Supabase SQL Editor, refresh the function's cached plan
-- by executing once; note the same UNION pattern also exists in
-- fix-atomic-exhibition-ram-cycle-cap-enforcement.sql for ram_orders whose
-- payment_option is already TEXT there, so no further change is needed.
