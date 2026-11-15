-- migrations/create-exhibition-order-atomic.sql
-- One transaction for a storefront exhibition checkout:
--
--   1. lock the season and the member,
--   2. price the requested products from the catalogue,
--   3. enforce the exhibition loan/savings cap,
--   4. reserve stock,
--   5. insert the order, its lines and the vendor payment rows,
--   6. clear the member's courtesy cart holds for those products.
--
-- The previous flow called check_exhibition_exposure_atomic and
-- exhibition_reserve_stock as separate PostgREST requests, then inserted the
-- order. Two checkouts for the same member could both pass the cap check
-- before either order existed. A single RPC holds the member lock until the
-- order rows are committed, so the second checkout sees the first one.
--
-- Apply after exhibition-global-limit-rules.sql and
-- fix-exhibition-cap-interest-consistency.sql. Safe to re-run.

CREATE OR REPLACE FUNCTION public.create_exhibition_order_atomic(
  p_order_id TEXT,
  p_cycle_id BIGINT,
  p_branch_id BIGINT,
  p_member_id TEXT,
  p_payment_option TEXT,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_member_name TEXT := '';
  v_rate_pct NUMERIC := 13;
  v_include_interest BOOLEAN := TRUE;
  v_principal NUMERIC := 0;
  v_interest NUMERIC := 0;
  v_total NUMERIC := 0;
  v_cap_amount NUMERIC := 0;
  v_total_qty INTEGER := 0;
  v_line RECORD;
  v_product RECORD;
  v_priced JSONB := '[]'::jsonb;
  v_reserve JSONB := '[]'::jsonb;
  v_check JSONB;
  v_order_pk BIGINT;
BEGIN
  IF p_payment_option NOT IN ('Cash', 'Loan', 'Savings') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid payment option.');
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Your cart is empty.');
  END IF;
  IF jsonb_array_length(p_lines) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Too many items in one order.');
  END IF;

  -- Lock the season so an admin cannot close it halfway through checkout.
  SELECT COALESCE(loan_interest_rate_pct, 13),
         COALESCE(exh_loan_cap_include_interest, TRUE)
    INTO v_rate_pct, v_include_interest
    FROM exhibition_cycles
   WHERE id = p_cycle_id
     AND status = 'active'
     AND (starts_at IS NULL OR starts_at <= NOW())
     AND (ends_at IS NULL OR ends_at > NOW())
   FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The Coop Exhibition is closed right now.');
  END IF;

  SELECT full_name INTO v_member_name
    FROM members
   WHERE member_id = p_member_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Member not found.');
  END IF;

  -- Lock product rows in product-id order. Sorting avoids deadlocks when two
  -- carts contain the same products in a different order.
  FOR v_line IN
    SELECT (value->>'product_id')::bigint AS product_id,
           SUM((value->>'qty')::int) AS qty
      FROM jsonb_array_elements(p_lines)
     GROUP BY 1
     ORDER BY 1
  LOOP
    IF v_line.product_id IS NULL OR v_line.qty IS NULL OR v_line.qty <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Invalid product in order.');
    END IF;

    SELECT p.id, p.vendor_id, p.name, p.sku, p.unit, p.vendor_price, p.qty
      INTO v_product
      FROM exhibition_products p
     WHERE p.id = v_line.product_id
       AND p.cycle_id = p_cycle_id
       AND p.branch_id = p_branch_id
       AND p.status = 'active'
       AND p.approval_status = 'approved'
     FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'A product in your cart is no longer available.');
    END IF;

    IF v_product.qty IS NOT NULL AND v_product.qty < v_line.qty THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format('Not enough stock for "%s" (%s left).', v_product.name, v_product.qty)
      );
    END IF;

    v_principal := v_principal + (v_product.vendor_price::numeric * v_line.qty);
    v_total_qty := v_total_qty + v_line.qty;

    v_priced := v_priced || jsonb_build_object(
      'vendor_id', v_product.vendor_id,
      'product_id', v_product.id,
      'product_name', v_product.name,
      'sku', v_product.sku,
      'unit', COALESCE(v_product.unit, 'each'),
      'vendor_price', v_product.vendor_price,
      'final_price', v_product.vendor_price,
      'qty', v_line.qty,
      'amount', v_product.vendor_price::numeric * v_line.qty
    );

    v_reserve := v_reserve || jsonb_build_object(
      'product_id', v_product.id,
      'qty', v_line.qty
    );
  END LOOP;

  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Your cart is empty.');
  END IF;

  IF p_payment_option = 'Loan' THEN
    v_interest := ROUND(v_principal * v_rate_pct / 100);
  END IF;
  v_total := v_principal + v_interest;
  v_cap_amount := CASE
    WHEN p_payment_option = 'Loan' AND NOT v_include_interest THEN v_principal
    ELSE v_total
  END;

  -- This locks the member row for the rest of this transaction.
  v_check := check_exhibition_exposure_atomic(
    p_member_id,
    p_payment_option,
    v_cap_amount,
    p_cycle_id::integer
  );

  IF NOT COALESCE((v_check->>'ok')::boolean, FALSE) THEN
    RETURN v_check;
  END IF;

  INSERT INTO exhibition_orders (
    order_id, cycle_id, branch_id, member_id, member_name_snapshot,
    payment_option, status, total_qty, total_amount, exh_loan_grace_used,
    source, captured_by_role, captured_by_code
  ) VALUES (
    p_order_id, p_cycle_id, p_branch_id, p_member_id, COALESCE(v_member_name, ''),
    p_payment_option, 'Pending', v_total_qty, v_total::bigint, FALSE,
    'storefront', 'member', p_member_id
  )
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_order_pk;

  -- ON CONFLICT does not abort, so raise instead of returning: the exception
  -- rolls back the transaction before any stock is decremented.
  IF v_order_pk IS NULL THEN
    RAISE EXCEPTION 'EXHIBITION_DUPLICATE_ORDER';
  END IF;

  INSERT INTO exhibition_order_lines (
    order_id, vendor_id, product_id, product_name, sku, unit,
    vendor_price, final_price, qty, amount
  )
  SELECT v_order_pk,
         (x->>'vendor_id')::bigint,
         (x->>'product_id')::bigint,
         x->>'product_name',
         x->>'sku',
         x->>'unit',
         (x->>'vendor_price')::bigint,
         (x->>'final_price')::bigint,
         (x->>'qty')::integer,
         (x->>'amount')::bigint
    FROM jsonb_array_elements(v_priced) x;

  PERFORM exhibition_reserve_stock(v_reserve);

  INSERT INTO exhibition_vendor_payment_status (
    cycle_id, vendor_id, order_id, amount, paid
  )
  SELECT p_cycle_id,
         vendor_id,
         v_order_pk,
         SUM(amount)::bigint,
         FALSE
    FROM exhibition_order_lines
   WHERE order_id = v_order_pk
   GROUP BY vendor_id;

  DELETE FROM exhibition_stock_holds
   WHERE member_id = p_member_id
     AND product_id IN (
       SELECT (x->>'product_id')::bigint
         FROM jsonb_array_elements(v_reserve) x
     );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'order_id', p_order_id,
    'order_db_id', v_order_pk,
    'total', v_total,
    'principal', v_principal,
    'interest', v_interest,
    'payment_option', p_payment_option,
    'eligibility', v_check
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_exhibition_order_atomic(TEXT, BIGINT, BIGINT, TEXT, TEXT, JSONB) FROM PUBLIC;
DO $$
BEGIN
  -- Supabase's default privileges can grant EXECUTE directly to these roles
  -- on a newly created function, so PUBLIC alone is not enough.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.create_exhibition_order_atomic(TEXT, BIGINT, BIGINT, TEXT, TEXT, JSONB) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.create_exhibition_order_atomic(TEXT, BIGINT, BIGINT, TEXT, TEXT, JSONB) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.create_exhibition_order_atomic(TEXT, BIGINT, BIGINT, TEXT, TEXT, JSONB) TO service_role;
  END IF;
END;
$$;

-- Ask PostgREST to pick up the new RPC without waiting for a cache refresh.
NOTIFY pgrst, 'reload schema';
