-- Migration: Atomic order creation to prevent race conditions
-- These functions lock the member row, calculate exposure,
-- check limits, and insert orders — all within a single transaction.
-- These functions lock the member row, calculate cross-module exposure,
-- check limits, and insert the order — all within a single transaction.

-- ============================================================
-- FOOD: Atomic order creation
-- ============================================================
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
BEGIN
  -- Lock the member row to prevent concurrent exposure checks
  SELECT member_id, savings, loans, global_limit
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

  -- Enforce limits
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


-- ============================================================
-- EXHIBITION: Atomic exposure check + limit enforcement
-- Returns eligibility data atomically. The caller still handles
-- stock reservation and order insertion separately (Exhibition
-- already has atomic stock reservation via exhibition_reserve_stock).
-- ============================================================
CREATE OR REPLACE FUNCTION check_exhibition_exposure_atomic(
  p_member_id TEXT,
  p_payment_option TEXT,
  p_total_amount NUMERIC,
  p_cycle_id INTEGER
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
BEGIN
  -- Lock the member row to prevent concurrent exposure checks
  SELECT member_id, savings, loans, global_limit
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

  -- Compute limits
  v_outstanding := v_member_loans + v_loan_exposure;
  v_savings_base := 0.5 * v_member_savings;
  v_savings_eligible := CASE WHEN v_outstanding > 0 THEN 0 ELSE GREATEST(0, v_savings_base - v_savings_exposure) END;

  v_raw_loan_limit := v_member_savings * 5;
  v_effective_limit := LEAST(v_raw_loan_limit, v_global_limit);
  v_base_eligible := GREATEST(0, v_effective_limit - v_outstanding);
  v_facility_remaining := GREATEST(0, 300000 - v_loan_exposure);
  v_cap_remaining := GREATEST(0, 1000000 - v_loan_exposure);
  v_loan_eligible := LEAST(v_base_eligible + v_facility_remaining, v_cap_remaining);

  -- Enforce limits
  IF p_payment_option = 'Savings' THEN
    IF v_savings_eligible <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Savings option is not available for this member.');
    END IF;
    IF p_total_amount > v_savings_eligible THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('Total exceeds your Savings limit (%s).', to_char(v_savings_eligible, 'FM999,999,999')));
    END IF;
  ELSIF p_payment_option = 'Loan' THEN
    IF v_loan_eligible <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Loan option is not available for this member.');
    END IF;
    IF p_total_amount > v_loan_eligible THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('Total %s exceeds Loan available %s',
          to_char(p_total_amount, 'FM999,999,999'), to_char(v_loan_eligible, 'FM999,999,999')));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'savingsEligible', v_savings_eligible,
    'loanEligible', v_loan_eligible,
    'outstandingLoansTotal', v_outstanding,
    'savingsExposure', v_savings_exposure,
    'loanExposure', v_loan_exposure
  );
END;
$$;


-- ============================================================
-- RAM: Atomic exposure check
-- Locks the member row and calculates RAM-only exposure
-- (RAM is intentionally isolated from Food/Exhibition).
-- ============================================================
CREATE OR REPLACE FUNCTION check_ram_exposure_atomic(
  p_member_id TEXT,
  p_payment_option TEXT,
  p_principal_amount NUMERIC,
  p_cycle_id INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_member RECORD;
  v_ram_statuses TEXT[] := ARRAY['Pending', 'Approved'];
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
  v_loan_eligible NUMERIC := 0;
BEGIN
  -- Lock the member row to prevent concurrent exposure checks
  SELECT member_id, savings, loans, global_limit, grade
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

  -- RAM-only exposure (Pending + Approved)
  SELECT COALESCE(SUM(CASE WHEN payment_option = 'Loan' THEN principal_amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN payment_option = 'Savings' THEN principal_amount ELSE 0 END), 0)
  INTO v_loan_exposure, v_savings_exposure
  FROM ram_orders
  WHERE member_id = p_member_id
    AND status IN ('Pending', 'Approved')
    AND (p_cycle_id IS NULL OR ram_cycle_id = p_cycle_id);

  -- Compute limits
  v_outstanding := v_member_loans + v_loan_exposure;
  v_savings_base := 0.5 * v_member_savings;
  v_savings_eligible := CASE WHEN v_outstanding > 0 THEN 0 ELSE GREATEST(0, v_savings_base - v_savings_exposure) END;

  v_raw_loan_limit := v_member_savings * 5;
  v_effective_limit := LEAST(v_raw_loan_limit, v_global_limit);
  v_loan_eligible := GREATEST(0, v_effective_limit - v_outstanding);

  -- Enforce limits
  IF p_payment_option = 'Savings' THEN
    IF v_savings_eligible <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Savings option not available for this member');
    END IF;
    IF p_principal_amount > v_savings_eligible THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('Total %s exceeds Savings limit %s',
          to_char(p_principal_amount, 'FM999,999,999'), to_char(v_savings_eligible, 'FM999,999,999')));
    END IF;
  ELSIF p_payment_option = 'Loan' THEN
    IF v_loan_eligible <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Loan option not available for this member');
    END IF;
    IF p_principal_amount > v_loan_eligible THEN
      RETURN jsonb_build_object('ok', false, 'error',
        format('Total %s exceeds Loan limit %s',
          to_char(p_principal_amount, 'FM999,999,999'), to_char(v_loan_eligible, 'FM999,999,999')));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'savingsEligible', v_savings_eligible,
    'loanEligible', v_loan_eligible,
    'outstandingLoansTotal', v_outstanding,
    'savingsExposure', v_savings_exposure,
    'loanExposure', v_loan_exposure
  );
END;
$$;
