-- Add atomic stock reservation/release for Coop Exhibition products.
--
-- exhibition_products.qty is a real stock count (NULL = unlimited). Checkout
-- must DECREMENT it atomically with an oversell guard, and cancel/restore must
-- release / re-reserve it — otherwise two members can both check out the last
-- unit (the old code only READ qty, never wrote it).
--
--   exhibition_reserve_stock(p_items JSONB)  — p_items: [{product_id, qty}]
--       Atomically subtracts qty from each product, guarded by
--       `qty IS NULL OR qty >= qty`. If any product can't cover the order the
--       whole call raises and ROLLS BACK (single transaction), so no partial
--       decrements leak. NULL (unlimited) products are left NULL.
--
--   exhibition_release_stock(p_items JSONB)  — p_items: [{product_id, qty}]
--       Adds qty back to each product (used when an order is cancelled).
--
-- SECURITY DEFINER so the service role can run them regardless of table RLS.

DROP FUNCTION IF EXISTS exhibition_reserve_stock(JSONB);
DROP FUNCTION IF EXISTS exhibition_release_stock(JSONB);

CREATE OR REPLACE FUNCTION exhibition_reserve_stock(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item JSONB;
  v_product_id BIGINT;
  v_qty BIGINT;
  v_failed JSONB := '[]'::jsonb;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::bigint;
    v_qty := (v_item->>'qty')::bigint;
    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE exhibition_products
       SET qty = qty - v_qty,
           updated_at = NOW()
     WHERE id = v_product_id
       AND (qty IS NULL OR qty >= v_qty);

    IF NOT FOUND THEN
      v_failed := v_failed || jsonb_build_object('product_id', v_product_id, 'qty', v_qty);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_failed) > 0 THEN
    RAISE EXCEPTION 'EXHIBITION_OVERSELL %', v_failed::text;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION exhibition_release_stock(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item JSONB;
  v_product_id BIGINT;
  v_qty BIGINT;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::bigint;
    v_qty := (v_item->>'qty')::bigint;
    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE exhibition_products
       SET qty = COALESCE(qty, 0) + v_qty,
           updated_at = NOW()
     WHERE id = v_product_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Grant to whichever roles exist (Supabase has anon/authenticated/service_role;
-- a local stack may only have anon/service_role).
DO $$
DECLARE
  v_role TEXT;
BEGIN
  FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION exhibition_reserve_stock(JSONB) TO %I', v_role);
      EXECUTE format('GRANT EXECUTE ON FUNCTION exhibition_release_stock(JSONB) TO %I', v_role);
    END IF;
  END LOOP;
END;
$$;
