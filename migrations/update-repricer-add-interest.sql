-- Update repricer to include interest for Loan orders and pin to public schema
-- Safe to run multiple times.

BEGIN;

-- Function: public.reprice_orders_for_branch_item
CREATE OR REPLACE FUNCTION public.reprice_orders_for_branch_item(
  p_branch_id INTEGER,
  p_item_id INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  updated_lines_count INTEGER := 0;
  has_cycle BOOLEAN := false;
  orders_has_cycle BOOLEAN := false;
BEGIN
  -- Detect whether branch_item_prices has a cycle_id column
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'branch_item_prices'
      AND column_name = 'cycle_id'
  ) INTO has_cycle;

  -- Detect whether orders has a cycle_id column
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'cycle_id'
  ) INTO orders_has_cycle;

  -- Refresh affected order lines (unit_price, branch_item_price_id, amount)
  IF has_cycle AND orders_has_cycle THEN
    UPDATE public.order_lines AS ol
    SET
      unit_price = bip.price + COALESCE((
        SELECT bim.amount
        FROM public.branch_item_markups bim
        WHERE bim.branch_id = o.delivery_branch_id
          AND bim.item_id = ol.item_id
          AND bim.active = TRUE
      ), 0),
      branch_item_price_id = bip.id,
      amount = (bip.price + COALESCE((
        SELECT bim.amount
        FROM public.branch_item_markups bim
        WHERE bim.branch_id = o.delivery_branch_id
          AND bim.item_id = ol.item_id
          AND bim.active = TRUE
      ), 0)) * ol.qty
    FROM public.orders AS o
    JOIN public.branch_item_prices AS bip
      ON bip.branch_id = o.delivery_branch_id
     AND bip.cycle_id = o.cycle_id
    WHERE ol.order_id = o.order_id
      AND bip.item_id = ol.item_id
      AND o.delivery_branch_id = p_branch_id
      AND ol.item_id = p_item_id
      AND o.status::text IN ('Pending','Posted','Delivered');
  ELSE
    UPDATE public.order_lines AS ol
    SET
      unit_price = bip.price + COALESCE((
        SELECT bim.amount
        FROM public.branch_item_markups bim
        WHERE bim.branch_id = o.delivery_branch_id
          AND bim.item_id = ol.item_id
          AND bim.active = TRUE
      ), 0),
      branch_item_price_id = bip.id,
      amount = (bip.price + COALESCE((
        SELECT bim.amount
        FROM public.branch_item_markups bim
        WHERE bim.branch_id = o.delivery_branch_id
          AND bim.item_id = ol.item_id
          AND bim.active = TRUE
      ), 0)) * ol.qty
    FROM public.orders AS o
    JOIN public.branch_item_prices AS bip
      ON bip.branch_id = o.delivery_branch_id
    WHERE ol.order_id = o.order_id
      AND bip.item_id = ol.item_id
      AND o.delivery_branch_id = p_branch_id
      AND ol.item_id = p_item_id
      AND o.status::text IN ('Pending','Posted','Delivered');
  END IF;

  GET DIAGNOSTICS updated_lines_count = ROW_COUNT;

  -- Recompute order totals; add 13% interest when payment_option = 'Loan'
  WITH s AS (
    SELECT ol.order_id, SUM(ol.amount) AS principal
    FROM public.order_lines AS ol
    GROUP BY ol.order_id
  )
  UPDATE public.orders AS o
  SET
    total_amount = COALESCE(s.principal, 0)
                 + CASE WHEN o.payment_option = 'Loan'
                        THEN ROUND(COALESCE(s.principal, 0) * 0.13)
                        ELSE 0
                   END,
    updated_at = NOW()
  FROM s
  WHERE o.delivery_branch_id = p_branch_id
    AND o.status::text IN ('Pending','Posted','Delivered')
    AND s.order_id = o.order_id
    AND EXISTS (
      SELECT 1
      FROM public.order_lines AS ol2
      WHERE ol2.order_id = o.order_id
        AND ol2.item_id = p_item_id
    );

  RETURN json_build_object('success', true, 'updated_lines', updated_lines_count);

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

ALTER FUNCTION public.reprice_orders_for_branch_item(INTEGER, INTEGER) SET search_path = public;

-- Trigger function
CREATE OR REPLACE FUNCTION public.on_branch_item_prices_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.reprice_orders_for_branch_item(NEW.branch_id, NEW.item_id);
  RETURN NEW;
END;
$$;

-- Trigger
DROP TRIGGER IF EXISTS trg_reprice_orders_on_bip_change ON public.branch_item_prices;
CREATE TRIGGER trg_reprice_orders_on_bip_change
AFTER INSERT OR UPDATE OF price ON public.branch_item_prices
FOR EACH ROW
EXECUTE FUNCTION public.on_branch_item_prices_changed();

-- Helper: Reprice all orders in a specific delivery branch
CREATE OR REPLACE FUNCTION public.reprice_orders_for_branch(
  p_branch_id INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  updated_orders INTEGER := 0;
BEGIN
  WITH s AS (
    SELECT ol.order_id, SUM(ol.amount) AS principal
    FROM order_lines ol
    GROUP BY ol.order_id
  ), updated AS (
    UPDATE orders o
    SET
      total_amount = COALESCE(s.principal, 0)
                   + CASE WHEN o.payment_option = 'Loan'
                          THEN ROUND(COALESCE(s.principal, 0) * 0.13)
                          ELSE 0
                     END,
      updated_at = NOW()
    FROM s
    WHERE o.delivery_branch_id = p_branch_id
      AND o.status::text IN ('Pending','Posted','Delivered')
      AND s.order_id = o.order_id
    RETURNING o.order_id
  )
  SELECT COUNT(*) INTO updated_orders FROM updated;

  RETURN json_build_object('success', true, 'updated_orders', updated_orders);

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

ALTER FUNCTION public.reprice_orders_for_branch(INTEGER) SET search_path = public;

-- Helper: Reprice all orders (across all branches)
CREATE OR REPLACE FUNCTION public.reprice_all_orders()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  updated_orders INTEGER := 0;
BEGIN
  WITH s AS (
    SELECT ol.order_id, SUM(ol.amount) AS principal
    FROM order_lines ol
    GROUP BY ol.order_id
  ), updated AS (
    UPDATE orders o
    SET
      total_amount = COALESCE(s.principal, 0)
                   + CASE WHEN o.payment_option = 'Loan'
                          THEN ROUND(COALESCE(s.principal, 0) * 0.13)
                          ELSE 0
                     END,
      updated_at = NOW()
    FROM s
    WHERE o.status::text IN ('Pending','Posted','Delivered')
      AND s.order_id = o.order_id
    RETURNING o.order_id
  )
  SELECT COUNT(*) INTO updated_orders FROM updated;

  RETURN json_build_object('success', true, 'updated_orders', updated_orders);

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Helper: Globally sync order_lines to current branch_item_prices, then recompute totals
CREATE OR REPLACE FUNCTION public.reprice_all_orders_full()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  updated_lines INTEGER := 0;
  updated_orders INTEGER := 0;
  has_cycle BOOLEAN := false;
  orders_has_cycle BOOLEAN := false;
BEGIN
  -- Detect cycle_id presence on both tables
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branch_item_prices' AND column_name = 'cycle_id'
  ) INTO has_cycle;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cycle_id'
  ) INTO orders_has_cycle;

  IF has_cycle AND orders_has_cycle THEN
    UPDATE public.order_lines AS ol
    SET
      unit_price = bip.price + COALESCE((
        SELECT bim.amount
        FROM public.branch_item_markups bim
        WHERE bim.branch_id = o.delivery_branch_id
          AND bim.item_id = ol.item_id
          AND bim.active = TRUE
      ), 0),
      branch_item_price_id = bip.id,
      amount = (bip.price + COALESCE((
        SELECT bim.amount
        FROM public.branch_item_markups bim
        WHERE bim.branch_id = o.delivery_branch_id
          AND bim.item_id = ol.item_id
          AND bim.active = TRUE
      ), 0)) * ol.qty
    FROM public.orders AS o
    JOIN public.branch_item_prices AS bip
      ON bip.branch_id = o.delivery_branch_id
     AND bip.cycle_id = o.cycle_id
    WHERE ol.order_id = o.order_id
      AND bip.item_id = ol.item_id
      AND o.status::text IN ('Pending','Posted','Delivered');
  ELSE
    UPDATE public.order_lines AS ol
    SET
      unit_price = bip.price + COALESCE((
        SELECT bim.amount
        FROM public.branch_item_markups bim
        WHERE bim.branch_id = o.delivery_branch_id
          AND bim.item_id = ol.item_id
          AND bim.active = TRUE
      ), 0),
      branch_item_price_id = bip.id,
      amount = (bip.price + COALESCE((
        SELECT bim.amount
        FROM public.branch_item_markups bim
        WHERE bim.branch_id = o.delivery_branch_id
          AND bim.item_id = ol.item_id
          AND bim.active = TRUE
      ), 0)) * ol.qty
    FROM public.orders AS o
    JOIN public.branch_item_prices AS bip
      ON bip.branch_id = o.delivery_branch_id
    WHERE ol.order_id = o.order_id
      AND bip.item_id = ol.item_id
      AND o.status::text IN ('Pending','Posted','Delivered');
  END IF;

  GET DIAGNOSTICS updated_lines = ROW_COUNT;

  -- Recompute totals with 13% interest for Loan orders
  WITH s AS (
    SELECT ol.order_id, SUM(ol.amount) AS principal
    FROM public.order_lines AS ol
    GROUP BY ol.order_id
  ), updated AS (
    UPDATE public.orders AS o
    SET
      total_amount = COALESCE(s.principal, 0)
                   + CASE WHEN o.payment_option = 'Loan'
                          THEN ROUND(COALESCE(s.principal, 0) * 0.13)
                          ELSE 0
                     END,
      updated_at = NOW()
    FROM s
    WHERE o.status::text IN ('Pending','Posted','Delivered')
      AND s.order_id = o.order_id
    RETURNING o.order_id
  )
  SELECT COUNT(*) INTO updated_orders FROM updated;

  RETURN json_build_object('success', true, 'updated_lines', updated_lines, 'updated_orders', updated_orders);

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

ALTER FUNCTION public.reprice_all_orders_full() SET search_path = public;

ALTER FUNCTION public.reprice_all_orders() SET search_path = public;

COMMIT;
