-- migrations/fix-exhibition-exposure-atomic-loan-formula.sql
-- Updates check_exhibition_exposure_atomic to use the dynamic facility pool formula
-- instead of hardcoded ₦300K facility and ₦1M cap.
--
-- New formula (mirrors fix-food-atomic-loan-formula.sql):
--   baseEligible = savings × 5 - outstanding
--   totalBorrowable = baseEligible + graceLoanMaxCap (facility pool)
--   ceiling = eligibleCap - cycleLoanUsed
--   loanEligible = min(totalBorrowable, ceiling)
--
-- The admin-configured cycle loan caps on the Exhibition Data Management page
-- are the sole source of truth.  The facility (grace amount) is added to
-- eligible members' base eligibility — it's a universal pool, not just
-- for non-eligible members.

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

  -- Compute limits (mirrors /api/orders/route.js logic)
  v_outstanding := v_member_loans + v_loan_exposure;
  v_savings_base := 0.5 * v_member_savings;
  v_savings_eligible := CASE WHEN v_outstanding > 0 THEN 0 ELSE GREATEST(0, v_savings_base - v_savings_exposure) END;

  -- Loan eligibility: base from savings, no hardcoded facility or cap
  v_raw_loan_limit := v_member_savings * 5 - v_outstanding;
  v_effective_limit := CASE WHEN v_global_limit > 0 THEN LEAST(v_raw_loan_limit, v_global_limit) ELSE v_raw_loan_limit END;
  v_base_eligible := GREATEST(0, v_effective_limit);
  -- loanEligible will be set by cycle-cap enforcement below; default to base
  v_loan_eligible := v_base_eligible;

  -- ── Exhibition cycle-cap enforcement (inside the transaction) ──
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

        -- Apply facility pool + ceiling formula.
        -- facility (graceLoanCap) is ADDED to baseEligible for all members.
        -- eligible cap is the absolute ceiling.
        IF v_cycle_loan_cap > 0 THEN
          v_loan_eligible := LEAST(v_base_eligible + v_cycle_grace_cap, GREATEST(0, v_cycle_loan_cap - v_cycle_loan_total));
        ELSE
          v_loan_eligible := v_base_eligible + v_cycle_grace_cap;
        END IF;

        -- Enforce ceiling
        v_cumulative_cap := v_cycle_loan_total + p_total_amount;

        IF v_cycle_loan_cap > 0 AND v_cumulative_cap > v_cycle_loan_cap THEN
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

        -- For non-eligible members (base = 0), check grace was not already used
        IF v_base_eligible <= 0 AND v_cycle_grace_cap > 0 THEN
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
      -- Column missing or other schema issue — skip cycle cap enforcement.
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
