-- migrations/exhibition-annual-limit-rules.sql
-- Exhibition lending now follows the annual limit model:
--
--   • Active members (Junior / Senior / Executive): their annual limit
--     (grade_limits.annual_limit) minus outstanding loans and this cycle's
--     food and exhibition loans. While that space is positive it is the limit;
--     once it runs out, the category amount for the cycle still applies.
--   • Pensioners: two flat figures per cycle — eligible when savings space is
--     left, non-eligible when none is.
--   • Retirees: strictly savings minus all loans, no grace.
--
-- The category amounts live on the cycle so each season can differ.
alter table exhibition_cycles
  add column if not exists exh_no_space_junior numeric not null default 700000,
  add column if not exists exh_no_space_senior numeric not null default 1500000,
  add column if not exists exh_no_space_executive numeric not null default 3000000;

CREATE OR REPLACE FUNCTION public.check_exhibition_exposure_atomic(p_member_id text, p_payment_option text, p_total_amount numeric, p_cycle_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- Annual-limit rule (active members)
  v_annual_limit NUMERIC := 0;
  v_space NUMERIC := 0;
  v_grade_category TEXT := '';
  v_group_amount NUMERIC := 0;
BEGIN
  -- Lock the member row
  SELECT member_id, savings, loans, global_limit, category, grade
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
    SELECT total_amount, payment_option::text FROM orders
    WHERE member_id = p_member_id
      AND status IN ('Pending', 'Posted', 'Delivered')
      AND (
        cycle_id = (SELECT id FROM cycles WHERE is_active ORDER BY id DESC LIMIT 1)
        OR (NOT EXISTS (SELECT 1 FROM cycles WHERE is_active) AND created_at >= v_year_start)
      )
    UNION ALL
    SELECT total_amount, payment_option::text FROM exhibition_orders
    WHERE member_id = p_member_id
      AND status IN ('Pending', 'Approved', 'Delivered', 'Confirmed')
      AND cycle_id = p_cycle_id
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
        exh_loan_grace_amount_cap_active,
        exh_no_space_junior,
        exh_no_space_senior,
        exh_no_space_executive
      INTO v_policy
      FROM exhibition_cycles
      WHERE id = p_cycle_id;

      IF FOUND THEN
        -- Member group: P = pensioner, R = retiree (single-letter category
        -- codes), with full-word fallbacks for legacy rows.
        v_member_cat := LOWER(COALESCE(v_member.category, ''));
        IF LEFT(v_member_cat, 1) = 'p' OR v_member_cat LIKE '%pension%' THEN
          v_group := 'pensioner';
        ELSIF LEFT(v_member_cat, 1) = 'r' OR v_member_cat LIKE '%retire%' THEN
          v_group := 'retiree';
        ELSE
          v_group := 'active';
        END IF;

        -- Exhibition loans already taken this cycle (read inside the member
        -- lock, so two concurrent checkouts cannot spend the same space).
        SELECT COALESCE(SUM(total_amount), 0)
        INTO v_cycle_loan_total
        FROM exhibition_orders
        WHERE member_id = p_member_id
          AND payment_option = 'Loan'
          AND cycle_id = p_cycle_id
          AND status IN ('Pending', 'Approved', 'Delivered', 'Confirmed');

        -- v_outstanding = members.loans + this cycle's food + this cycle's
        -- exhibition loans, so every space below is net of what is taken.
        IF v_group = 'retiree' THEN
          -- Retirees: strictly savings minus all loans, no grace.
          v_loan_eligible := GREATEST(0, v_member_savings - v_outstanding);
        ELSIF v_group = 'pensioner' THEN
          -- Pensioners ignore the annual limit: one eligible figure and one
          -- non-eligible figure, chosen by whether savings space is left.
          IF v_member_savings - v_outstanding > 0 THEN
            v_group_amount := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_eligible_amount_cap_pensioner, 0)));
          ELSE
            v_group_amount := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_grace_amount_cap_pensioner, 0)));
          END IF;
          v_loan_eligible := GREATEST(0, v_group_amount - v_cycle_loan_total);
        ELSE
          -- Active members: annual limit from the grade table minus everything
          -- already taken. Space is the limit while it lasts; once it is gone
          -- the category amount (Junior/Senior/Executive) still applies.
          SELECT COALESCE(g.annual_limit, 0), COALESCE(g.category, 'Junior')
          INTO v_annual_limit, v_grade_category
          FROM grade_limits g
          WHERE LOWER(g.grade) = LOWER(COALESCE(v_member.grade, ''))
          LIMIT 1;

          v_space := COALESCE(v_annual_limit, 0) - v_outstanding;
          IF v_space > 0 THEN
            v_loan_eligible := v_space;
          ELSE
            IF LOWER(COALESCE(v_grade_category, 'Junior')) = 'executive' THEN
              v_group_amount := GREATEST(0, TRUNC(COALESCE(v_policy.exh_no_space_executive, 0)));
            ELSIF LOWER(COALESCE(v_grade_category, 'Junior')) = 'senior' THEN
              v_group_amount := GREATEST(0, TRUNC(COALESCE(v_policy.exh_no_space_senior, 0)));
            ELSE
              v_group_amount := GREATEST(0, TRUNC(COALESCE(v_policy.exh_no_space_junior, 0)));
            END IF;
            v_loan_eligible := GREATEST(0, v_group_amount - v_cycle_loan_total);
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
$function$;
