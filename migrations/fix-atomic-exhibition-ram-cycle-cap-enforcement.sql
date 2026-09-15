-- Migration: Harden Exhibition + RAM atomic exposure checks with cycle-cap enforcement
-- Mirrors the fix applied to create_food_order_atomic in
-- fix-atomic-order-cycle-cap-enforcement.sql.
--
-- Exhibition: enforces exh_loan_eligible_amount_cap_* and exh_loan_grace_amount_cap_*
-- from exhibition_cycles, plus the exh_loan_grace_used once-per-cycle rule.
--
-- RAM: enforces eligible_loan_qty_* and grace_loan_qty_* from ram_cycles.
-- Adds p_qty parameter (default 1) so the quantity cap can be checked atomically.

-- ============================================================
-- EXHIBITION: Atomic exposure check + cycle cap enforcement
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
  -- Cycle-cap enforcement
  v_cycle_loan_cap NUMERIC := 0;
  v_cycle_grace_cap NUMERIC := 0;
  v_cycle_loan_total NUMERIC := 0;
  v_cumulative_cap NUMERIC := 0;
  v_eligible_fallback NUMERIC := 0;
  v_grace_fallback NUMERIC := 0;
  v_policy RECORD;
  v_member_cat TEXT;
  v_group TEXT;
BEGIN
  -- Lock the member row
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

  -- Cross-module exposure (Food + Exhibition)
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

  -- ── Exhibition cycle-cap enforcement ─────────────────────────────
  IF p_cycle_id IS NOT NULL AND p_payment_option = 'Loan' THEN
    BEGIN
      SELECT
        exh_loan_eligible_amount_cap_pensioner,
        exh_loan_eligible_amount_cap_retiree,
        exh_loan_eligible_amount_cap_active,
        exh_loan_grace_amount_cap_pensioner,
        exh_loan_grace_amount_cap_retiree,
        exh_loan_grace_amount_cap_active
      INTO v_policy
      FROM exhibition_cycles
      WHERE id = p_cycle_id;

      IF FOUND THEN
        v_member_cat := LOWER(COALESCE(v_member.category, ''));
        IF v_member_cat LIKE '%pension%' THEN
          v_group := 'pensioner';
        ELSIF v_member_cat LIKE '%retire%' THEN
          v_group := 'retiree';
        ELSE
          v_group := 'active';
        END IF;

        IF v_group = 'pensioner' THEN
          v_cycle_loan_cap := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_eligible_amount_cap_pensioner, 0)));
          v_cycle_grace_cap := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_grace_amount_cap_pensioner, 0)));
        ELSIF v_group = 'retiree' THEN
          v_cycle_loan_cap := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_eligible_amount_cap_retiree, 0)));
          v_cycle_grace_cap := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_grace_amount_cap_retiree, 0)));
        ELSE
          v_cycle_loan_cap := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_eligible_amount_cap_active, 0)));
          v_cycle_grace_cap := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_grace_amount_cap_active, 0)));
        END IF;

        -- Cumulative exhibition loan total for this cycle (inside the lock)
        IF v_cycle_loan_cap > 0 OR v_cycle_grace_cap > 0 THEN
          SELECT COALESCE(SUM(total_amount), 0)
          INTO v_cycle_loan_total
          FROM exhibition_orders
          WHERE member_id = p_member_id
            AND payment_option = 'Loan'
            AND cycle_id = p_cycle_id
            AND status IN ('Pending', 'Approved', 'Delivered');
        END IF;

        v_cumulative_cap := v_cycle_loan_total + p_total_amount;

        IF v_cycle_loan_cap > 0 AND v_cumulative_cap > v_cycle_loan_cap THEN
          -- Exceeds eligible cap — check grace fallback
          IF v_cycle_grace_cap <= 0 OR v_cumulative_cap > v_cycle_grace_cap THEN
            RETURN jsonb_build_object(
              'ok', false,
              'error', format(
                'Exhibition cycle loan limit of %s exceeded. You already have %s in this cycle; adding %s would exceed the limit.',
                to_char(v_cycle_loan_cap, 'FM999,999,999'),
                to_char(v_cycle_loan_total, 'FM999,999,999'),
                to_char(p_total_amount, 'FM999,999,999')
              )
            );
          END IF;

          -- Grace used once per cycle
          IF EXISTS (
            SELECT 1 FROM exhibition_orders
            WHERE member_id = p_member_id
              AND payment_option = 'Loan'
              AND exh_loan_grace_used = TRUE
              AND cycle_id = p_cycle_id
              AND status IN ('Pending', 'Approved', 'Delivered')
          ) THEN
            RETURN jsonb_build_object(
              'ok', false,
              'error', 'Grace has already been used for this member in the current exhibition cycle.'
            );
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- Enforce general limits
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
-- RAM: Atomic exposure check + quantity cap enforcement
-- Adds p_qty parameter (default 1) for atomic quantity cap checks.
-- ============================================================
CREATE OR REPLACE FUNCTION check_ram_exposure_atomic(
  p_member_id TEXT,
  p_payment_option TEXT,
  p_principal_amount NUMERIC,
  p_cycle_id INTEGER DEFAULT NULL,
  p_qty INTEGER DEFAULT 1
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
  -- Cycle quantity-cap enforcement
  v_eligible_qty_cap INTEGER := 0;
  v_grace_qty_cap INTEGER := 0;
  v_cycle_loan_qty INTEGER := 0;
  v_member_grade TEXT;
  v_group TEXT;
  v_cycle_policy RECORD;
BEGIN
  -- Lock the member row
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

  -- ── RAM cycle quantity-cap enforcement ──────────────────────────
  IF p_cycle_id IS NOT NULL AND p_payment_option = 'Loan' THEN
    BEGIN
      v_member_grade := LOWER(COALESCE(v_member.grade, ''));
      IF v_member_grade LIKE '%pensioner%' THEN
        v_group := 'pensioner';
      ELSIF v_member_grade LIKE '%retiree%' THEN
        v_group := 'retiree';
      ELSE
        v_group := 'active';
      END IF;

      -- Try explicit per-category columns first (newer schema)
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ram_cycles' AND column_name = 'eligible_loan_qty_active'
      ) THEN
        SELECT
          eligible_loan_qty_pensioner, eligible_loan_qty_retiree, eligible_loan_qty_active,
          grace_loan_qty_pensioner, grace_loan_qty_retiree, grace_loan_qty_active
        INTO v_cycle_policy
        FROM ram_cycles
        WHERE id = p_cycle_id;

        IF FOUND THEN
          IF v_group = 'pensioner' THEN
            v_eligible_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.eligible_loan_qty_pensioner, 0)));
            v_grace_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.grace_loan_qty_pensioner, 0)));
          ELSIF v_group = 'retiree' THEN
            v_eligible_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.eligible_loan_qty_retiree, 0)));
            v_grace_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.grace_loan_qty_retiree, 0)));
          ELSE
            v_eligible_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.eligible_loan_qty_active, 0)));
            v_grace_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.grace_loan_qty_active, 0)));
          END IF;
        END IF;
      ELSE
        -- Legacy schema: loan_qty_cap_pensioner, loan_qty_cap_other, loan_grace_qty
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ram_cycles' AND column_name = 'loan_qty_cap_pensioner'
        ) THEN
          SELECT loan_qty_cap_pensioner, loan_qty_cap_other, loan_grace_qty
          INTO v_cycle_policy
          FROM ram_cycles
          WHERE id = p_cycle_id;

          IF FOUND THEN
            IF v_group = 'pensioner' THEN
              v_eligible_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.loan_qty_cap_pensioner, 0)));
            ELSE
              v_eligible_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.loan_qty_cap_other, 0)));
            END IF;
            v_grace_qty_cap := GREATEST(0, TRUNC(COALESCE(v_cycle_policy.loan_grace_qty, 0)));
          END IF;
        END IF;
      END IF;

      -- Cumulative loan quantity for this cycle (inside the lock)
      IF v_eligible_qty_cap > 0 OR v_grace_qty_cap > 0 THEN
        SELECT COALESCE(SUM(qty), 0)
        INTO v_cycle_loan_qty
        FROM ram_orders
        WHERE member_id = p_member_id
          AND payment_option = 'Loan'
          AND ram_cycle_id = p_cycle_id
          AND status IN ('Pending', 'Approved');
      END IF;

      -- Enforce quantity cap
      IF v_eligible_qty_cap > 0 AND (v_cycle_loan_qty + p_qty) > v_eligible_qty_cap THEN
        -- Exceeds eligible cap — check grace fallback
        IF v_grace_qty_cap <= 0 OR (v_cycle_loan_qty + p_qty) > v_grace_qty_cap THEN
          RETURN jsonb_build_object(
            'ok', false,
            'error', format(
              'RAM cycle loan limit of %s items exceeded. You already have %s in this cycle; adding %s would exceed the limit.',
              v_eligible_qty_cap,
              v_cycle_loan_qty,
              p_qty
            )
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- Enforce general limits
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
