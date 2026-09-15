-- Migration: Harden create_food_order_atomic with cycle-cap enforcement
-- The previous version only checked the general eligibility (₦1M / ₦300K
-- facility) inside the transaction.  The per-category cycle caps
-- (food_loan_eligible_amount_cap_*) and grace logic were only checked in
-- the JS pre-code, which runs outside the transaction and is vulnerable
-- to race conditions where two concurrent requests both read stale
-- cycleLoanTotal and both pass the cap check.
--
-- This migration replaces the function so that:
--   1. The active cycle's per-category eligible & grace caps are read
--      inside the transaction (after the FOR UPDATE lock).
--   2. The member's cumulative loan total for the current cycle is
--      re-queried inside the transaction.
--   3. The cycle cap, grace cap, and grace-used-once checks are all
--      enforced inside the same transaction that inserts the order.

CREATE OR REPLACE FUNCTION create_food_order_atomic(
  p_member_id TEXT,
  p_member_name TEXT,
  p_member_category TEXT,
  p_branch_id INTEGER,
  p_delivery_branch_id INTEGER,
  p_department_id INTEGER,
  p_payment_option TEXT,
  p_total_amount NUMERIC,
  p_cycle_id INTEGER,
  p_lines JSONB,          -- [{item_id, branch_item_price_id, unit_price, qty, amount}]
  p_grace_used BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_member RECORD;
  v_year_start TIMESTAMPTZ;
  v_loan_exposure NUMERIC := 0;
  v_savings_exposure NUMERIC := 0;
  v_member_loans NUMERIC := 0;
  v_member_savings NUMERIC := 0;
  v_global_limit NUMERIC := 0;
  v_outstanding NUMERIC := 0;
  v_savings_base NUMERIC := 0;
  v_savings_eligible NUMERIC := 0;
  v_raw_loan_limit NUMERIC := 0;
  v_effective_limit NUMERIC := 0;
  v_base_eligible NUMERIC := 0;
  v_facility_remaining NUMERIC := 0;
  v_cap_remaining NUMERIC := 0;
  v_loan_eligible NUMERIC := 0;
  v_order_id TEXT;
  v_order RECORD;
  v_line JSONB;
  v_inserted_lines INTEGER;
  -- Cycle-cap enforcement variables
  v_cycle_loan_cap NUMERIC := 0;
  v_cycle_grace_cap NUMERIC := 0;
  v_cycle_loan_total NUMERIC := 0;
  v_cumulative_cap_amount NUMERIC := 0;
  v_eligible_fallback NUMERIC := 0;
  v_grace_fallback NUMERIC := 0;
  v_policy RECORD;
  v_member_category_lower TEXT;
  v_group TEXT;
BEGIN
  -- Lock the member row to prevent concurrent exposure checks
  SELECT member_id, savings, loans, global_limit, category
  INTO v_member
  FROM members
  WHERE member_id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Member not found');
  END IF;

  v_member_savings := COALESCE(v_member.savings, 0);
  v_member_loans := COALESCE(v_member.loans, 0);
  v_global_limit := COALESCE(v_member.global_limit, 0);

  -- Calculate cross-module exposure (Food + Exhibition) for current calendar year
  v_year_start := date_trunc('year', NOW());

  SELECT COALESCE(SUM(CASE WHEN payment_option = 'Loan' THEN total_amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN payment_option = 'Savings' THEN total_amount ELSE 0 END), 0)
  INTO v_loan_exposure, v_savings_exposure
  FROM (
    SELECT total_amount, payment_option FROM orders
    WHERE member_id = p_member_id
      AND status IN ('Pending', 'Posted', 'Delivered')
      AND created_at >= v_year_start
    UNION ALL
    SELECT total_amount, payment_option FROM exhibition_orders
    WHERE member_id = p_member_id
      AND status IN ('Pending', 'Approved', 'Delivered')
      AND created_at >= v_year_start
  ) combined;

  -- Compute limits (mirrors /api/orders/route.js logic)
  v_outstanding := v_member_loans + v_loan_exposure;
  v_savings_base := 0.5 * v_member_savings;
  v_savings_eligible := CASE WHEN v_outstanding > 0 THEN 0 ELSE GREATEST(0, v_savings_base - v_savings_exposure) END;

  v_raw_loan_limit := v_member_savings * 5 - v_outstanding;
  v_effective_limit := LEAST(v_raw_loan_limit, v_global_limit);
  v_base_eligible := GREATEST(0, v_effective_limit);
  v_facility_remaining := GREATEST(0, 300000 - v_loan_exposure);
  v_cap_remaining := GREATEST(0, 1000000 - v_loan_exposure);
  v_loan_eligible := LEAST(v_base_eligible + v_facility_remaining, v_cap_remaining);

  -- ── Cycle-cap enforcement (inside the transaction) ──────────────
  -- Read per-category cycle caps and the member's cumulative loan
  -- total for the current cycle, then enforce the cap.  Wrapped in
  -- an EXCEPTION block so older schemas missing the columns are
  -- gracefully skipped (the function still works without cycle caps).
  IF p_cycle_id IS NOT NULL AND p_payment_option = 'Loan' THEN
    BEGIN
      SELECT
        food_loan_eligible_amount_cap,
        food_loan_eligible_amount_cap_pensioner,
        food_loan_eligible_amount_cap_retiree,
        food_loan_eligible_amount_cap_active,
        food_loan_grace_amount_cap,
        food_loan_grace_amount_cap_pensioner,
        food_loan_grace_amount_cap_retiree,
        food_loan_grace_amount_cap_active
      INTO v_policy
      FROM cycles
      WHERE id = p_cycle_id;

      IF FOUND THEN
        v_member_category_lower := LOWER(COALESCE(v_member.category, ''));
        IF v_member_category_lower LIKE '%pension%' THEN
          v_group := 'pensioner';
        ELSIF v_member_category_lower LIKE '%retire%' THEN
          v_group := 'retiree';
        ELSE
          v_group := 'active';
        END IF;

        -- Fallback (legacy single-column cap)
        v_eligible_fallback := GREATEST(0, TRUNC(COALESCE(v_policy.food_loan_eligible_amount_cap, 0)));
        v_grace_fallback    := GREATEST(0, TRUNC(COALESCE(v_policy.food_loan_grace_amount_cap, 0)));

        -- Per-category eligible cap
        IF v_group = 'pensioner' THEN
          v_cycle_loan_cap := GREATEST(0, TRUNC(COALESCE(v_policy.food_loan_eligible_amount_cap_pensioner, 0)));
          v_cycle_grace_cap := GREATEST(0, TRUNC(COALESCE(v_policy.food_loan_grace_amount_cap_pensioner, 0)));
        ELSIF v_group = 'retiree' THEN
          v_cycle_loan_cap := GREATEST(0, TRUNC(COALESCE(v_policy.food_loan_eligible_amount_cap_retiree, 0)));
          v_cycle_grace_cap := GREATEST(0, TRUNC(COALESCE(v_policy.food_loan_grace_amount_cap_retiree, 0)));
        ELSE
          v_cycle_loan_cap := GREATEST(0, TRUNC(COALESCE(v_policy.food_loan_eligible_amount_cap_active, 0)));
          v_cycle_grace_cap := GREATEST(0, TRUNC(COALESCE(v_policy.food_loan_grace_amount_cap_active, 0)));
        END IF;

        -- Use fallback if per-category cap is 0
        IF v_cycle_loan_cap = 0 THEN v_cycle_loan_cap := v_eligible_fallback; END IF;
        IF v_cycle_grace_cap = 0 THEN v_cycle_grace_cap := v_grace_fallback; END IF;

        -- Query cumulative loan total for THIS cycle (inside the lock)
        IF v_cycle_loan_cap > 0 OR v_cycle_grace_cap > 0 THEN
          SELECT COALESCE(SUM(total_amount), 0)
          INTO v_cycle_loan_total
          FROM orders
          WHERE member_id = p_member_id
            AND payment_option = 'Loan'
            AND cycle_id = p_cycle_id
            AND status IN ('Pending', 'Posted', 'Delivered');
        END IF;

        -- Enforce eligible cycle cap
        v_cumulative_cap_amount := v_cycle_loan_total + p_total_amount;

        IF v_cycle_loan_cap > 0 AND v_cumulative_cap_amount > v_cycle_loan_cap THEN
          -- Exceeds eligible cap — check grace fallback
          IF v_cycle_grace_cap <= 0 OR v_cumulative_cap_amount > v_cycle_grace_cap THEN
            RETURN jsonb_build_object(
              'ok', false,
              'error', format(
                'Cycle loan limit of %s exceeded. You already have %s in this cycle; adding %s would exceed the limit.',
                to_char(v_cycle_loan_cap, 'FM999,999,999'),
                to_char(v_cycle_loan_total, 'FM999,999,999'),
                to_char(p_total_amount, 'FM999,999,999')
              )
            );
          END IF;

          -- Grace cap allows it — check if grace was already used this cycle
          IF EXISTS (
            SELECT 1 FROM orders
            WHERE member_id = p_member_id
              AND payment_option = 'Loan'
              AND food_loan_grace_used = TRUE
              AND status IN ('Pending', 'Posted', 'Delivered')
              AND cycle_id = p_cycle_id
          ) THEN
            RETURN jsonb_build_object(
              'ok', false,
              'error', 'Grace has already been used for this member in the current cycle.'
            );
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Column missing or other schema issue — skip cycle cap enforcement.
      -- The general eligibility check still applies.
      NULL;
    END;
  END IF;

  -- Enforce general limits
  IF p_payment_option = 'Savings' THEN
    IF v_outstanding > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Savings not allowed while loans outstanding');
    END IF;
    IF p_total_amount > v_savings_eligible THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('Total %s exceeds Savings available %s',
          to_char(p_total_amount, 'FM999,999,999'), to_char(v_savings_eligible, 'FM999,999,999')));
    END IF;
  ELSIF p_payment_option = 'Loan' THEN
    IF p_total_amount > v_loan_eligible THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('Total %s exceeds Loan available %s',
          to_char(p_total_amount, 'FM999,999,999'), to_char(v_loan_eligible, 'FM999,999,999')));
    END IF;
  ELSIF p_payment_option != 'Cash' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid payment option');
  END IF;

  -- Generate order ID
  v_order_id := 'F' || to_char(NOW(), 'YYMMDD') || '-' || upper(md5(random()::text));

  -- Insert order
  INSERT INTO orders (
    order_id, member_id, member_name_snapshot, member_category_snapshot,
    branch_id, delivery_branch_id, department_id,
    payment_option, total_amount, status, cycle_id, food_loan_grace_used
  ) VALUES (
    v_order_id, p_member_id, p_member_name, p_member_category,
    p_branch_id, p_delivery_branch_id, p_department_id,
    p_payment_option, p_total_amount, 'Pending', p_cycle_id, p_grace_used
  )
  RETURNING * INTO v_order;

  -- Insert order lines
  INSERT INTO order_lines (order_id, item_id, branch_item_price_id, unit_price, qty, amount)
  SELECT v_order.order_id, (line->>'item_id')::INTEGER, (line->>'branch_item_price_id')::INTEGER,
         (line->>'unit_price')::NUMERIC, (line->>'qty')::INTEGER, (line->>'amount')::NUMERIC
  FROM jsonb_array_elements(p_lines) AS line;

  GET DIAGNOSTICS v_inserted_lines = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'total', p_total_amount,
    'eligibility', jsonb_build_object(
      'savingsEligible', v_savings_eligible,
      'loanEligible', v_loan_eligible
    )
  );
END;
$$;
