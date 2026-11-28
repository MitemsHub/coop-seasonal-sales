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
  v_loan_eligible NUMERIC := 0;
  v_space NUMERIC := 0;
  v_cycle_loan_total NUMERIC := 0;
  v_ceiling NUMERIC := 0;
  v_grace NUMERIC := 0;
  v_policy RECORD;
  v_member_cat TEXT;
  v_group TEXT := 'active';
  v_cap_includes_interest BOOLEAN := TRUE;
  v_grade_category TEXT := 'Junior';
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

  -- Read the cycle's cap basis once. When interest is excluded, prior
  -- exhibition orders must be measured by their line (principal) amount;
  -- otherwise interest quietly consumes the member's cap.
  IF p_cycle_id IS NOT NULL THEN
    SELECT COALESCE(exh_loan_cap_include_interest, TRUE)
    INTO v_cap_includes_interest
    FROM exhibition_cycles
    WHERE id = p_cycle_id;
  END IF;
  v_cap_includes_interest := COALESCE(v_cap_includes_interest, TRUE);

  -- Cross-module exposure: this cycle's food orders plus this season's
  -- exhibition orders (falling back to the calendar year when no food cycle
  -- is active). Food taken in the running distribution counts here.
  v_year_start := date_trunc('year', NOW());

  SELECT COALESCE(SUM(CASE WHEN payment_option = 'Loan' THEN total_amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN payment_option = 'Savings' THEN total_amount ELSE 0 END), 0)
  INTO v_loan_exposure, v_savings_exposure
  FROM (
    -- Food loan orders count by PRINCIPAL (their line amounts). Their stored
    -- total_amount carries the distribution interest, which must not eat
    -- exhibition room; the fallback covers orders with no lines.
    SELECT
      CASE WHEN o.payment_option::text = 'Loan'
        THEN COALESCE((SELECT SUM(ol.amount) FROM order_lines ol WHERE ol.order_id = o.order_id), o.total_amount)
        ELSE o.total_amount
      END AS total_amount,
      o.payment_option::text AS payment_option
    FROM orders o
    WHERE o.member_id = p_member_id
      AND o.status IN ('Pending', 'Posted', 'Delivered')
      AND (
        o.cycle_id = (SELECT id FROM cycles WHERE is_active ORDER BY id DESC LIMIT 1)
        OR (NOT EXISTS (SELECT 1 FROM cycles WHERE is_active) AND o.created_at >= v_year_start)
      )
    UNION ALL
    SELECT
      CASE WHEN v_cap_includes_interest THEN eo.total_amount
        ELSE COALESCE((SELECT SUM(eol.amount) FROM exhibition_order_lines eol WHERE eol.order_id = eo.id), eo.total_amount)
      END,
      eo.payment_option::text
    FROM exhibition_orders eo
    WHERE eo.member_id = p_member_id
      AND eo.status IN ('Pending', 'Approved', 'Delivered', 'Confirmed')
      AND eo.cycle_id = p_cycle_id
  ) combined;

  v_outstanding := v_member_loans + v_loan_exposure;
  v_savings_base := 0.5 * v_member_savings;
  v_savings_eligible := CASE WHEN v_outstanding > 0 THEN 0 ELSE GREATEST(0, v_savings_base - v_savings_exposure) END;

  -- Member group: P = pensioner, R = retiree (single-letter category codes),
  -- with full-word fallbacks for legacy rows.
  v_member_cat := LOWER(COALESCE(v_member.category, ''));
  IF LEFT(v_member_cat, 1) = 'p' OR v_member_cat LIKE '%pension%' THEN
    v_group := 'pensioner';
  ELSIF LEFT(v_member_cat, 1) = 'r' OR v_member_cat LIKE '%retire%' THEN
    v_group := 'retiree';
  ELSE
    v_group := 'active';
  END IF;

  -- Savings × 5 less everything already taken, capped by the member's global
  -- limit. Exposure already nets out this cycle's exhibition loans, so no
  -- second subtraction happens on this path.
  v_space := v_member_savings * 5 - v_outstanding;
  IF v_global_limit > 0 THEN
    v_space := LEAST(v_space, v_global_limit);
  END IF;

  IF v_group = 'retiree' THEN
    -- Retirees never get the multiplier: strictly savings minus all loans.
    v_loan_eligible := GREATEST(0, v_member_savings - v_outstanding);
  ELSE
    v_loan_eligible := GREATEST(0, v_space);
  END IF;

  -- ── Season rules (inside the transaction, on the locked member row) ──
  IF p_cycle_id IS NOT NULL AND p_payment_option = 'Loan' THEN
    BEGIN
      SELECT
        exh_loan_eligible_amount_cap_pensioner,
        exh_loan_grace_amount_cap_pensioner,
        exh_no_space_junior,
        exh_no_space_senior,
        exh_no_space_executive
      INTO v_policy
      FROM exhibition_cycles
      WHERE id = p_cycle_id;

      IF FOUND THEN
        -- Exhibition loans already taken this season.
        SELECT COALESCE(SUM(
          CASE WHEN v_cap_includes_interest THEN eo.total_amount
            ELSE COALESCE((SELECT SUM(eol.amount) FROM exhibition_order_lines eol WHERE eol.order_id = eo.id), eo.total_amount)
          END
        ), 0)
        INTO v_cycle_loan_total
        FROM exhibition_orders eo
        WHERE eo.member_id = p_member_id
          AND eo.payment_option = 'Loan'
          AND eo.cycle_id = p_cycle_id
          AND eo.status IN ('Pending', 'Approved', 'Delivered', 'Confirmed');

        IF v_group = 'retiree' THEN
          -- No grace, no ceiling: savings minus everything.
          v_loan_eligible := GREATEST(0, v_member_savings - v_outstanding);
        ELSIF v_group = 'pensioner' THEN
          v_ceiling := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_eligible_amount_cap_pensioner, 0)));
          IF v_space > 0 THEN
            -- Pensioner grace rides on top of space too; the pensioner
            -- ceiling stays the absolute cap for the season.
            v_grace := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_grace_amount_cap_pensioner, 0)));
            v_loan_eligible := v_space + v_grace;
            IF v_ceiling > 0 THEN
              v_loan_eligible := LEAST(v_loan_eligible, GREATEST(0, v_ceiling - v_cycle_loan_total));
            END IF;
          ELSE
            -- No savings space: the pensioner grace amount is the pool, and it
            -- decrements with whatever has already been borrowed this season.
            v_grace := GREATEST(0, TRUNC(COALESCE(v_policy.exh_loan_grace_amount_cap_pensioner, 0)));
            v_loan_eligible := GREATEST(0, v_grace - v_cycle_loan_total);
          END IF;
        ELSE
          -- The grade pool is the season's facility, not a last resort: it
          -- rides on top of savings space, so a member with ₦1 of space is
          -- never worse off than one with none.
          SELECT COALESCE(g.category, 'Junior')
          INTO v_grade_category
          FROM grade_limits g
          WHERE LOWER(g.grade) = LOWER(COALESCE(v_member.grade, ''))
          LIMIT 1;

          IF LOWER(COALESCE(v_grade_category, 'Junior')) = 'executive' THEN
            v_grace := GREATEST(0, TRUNC(COALESCE(v_policy.exh_no_space_executive, 0)));
          ELSIF LOWER(COALESCE(v_grade_category, 'Junior')) = 'senior' THEN
            v_grace := GREATEST(0, TRUNC(COALESCE(v_policy.exh_no_space_senior, 0)));
          ELSE
            v_grace := GREATEST(0, TRUNC(COALESCE(v_policy.exh_no_space_junior, 0)));
          END IF;

          IF v_space > 0 THEN
            -- Space already nets out this season's usage, so the pool rides flat.
            v_loan_eligible := v_space + v_grace;
          ELSE
            v_loan_eligible := GREATEST(0, v_grace - v_cycle_loan_total);
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Column missing or other schema issue — skip season enforcement.
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
    'loanExposure', v_loan_exposure,
    'memberGroup', v_group
  );
END;
$function$
