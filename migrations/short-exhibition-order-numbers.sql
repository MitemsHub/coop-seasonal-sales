-- migrations/short-exhibition-order-numbers.sql
-- Exhibition invoices should read like EXH001 instead of a long random code.
--
-- Existing order IDs are left untouched so previously shared invoices keep
-- working. Every new order (storefront or counter invoice) uses the sequence.
-- Safe to run more than once.

CREATE SEQUENCE IF NOT EXISTS exhibition_order_number_seq START 1;

-- Continue after the largest existing numeric or EXHnnn value. Older random
-- EXH-2026-XXXXXX IDs are deliberately ignored.
SELECT setval(
  'exhibition_order_number_seq',
  GREATEST(
    COALESCE((SELECT MAX(order_id::bigint) FROM exhibition_orders WHERE order_id ~ '^[0-9]+$'), 0),
    COALESCE((SELECT MAX(substring(order_id from 4)::bigint) FROM exhibition_orders WHERE order_id ~ '^EXH[0-9]+$'), 0)
  ) + 1,
  false
);

ALTER TABLE exhibition_orders
  ALTER COLUMN order_id
  SET DEFAULT ('EXH' || lpad(nextval('exhibition_order_number_seq')::text, 3, '0'));

-- The member checkout RPC still needs an explicit order id, so expose a tiny
-- allocator that returns the same short format as the column default.
CREATE OR REPLACE FUNCTION public.next_exhibition_order_id()
RETURNS TEXT
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'EXH' || lpad(nextval('exhibition_order_number_seq')::text, 3, '0')
$$;

REVOKE ALL ON FUNCTION public.next_exhibition_order_id() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.next_exhibition_order_id() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.next_exhibition_order_id() FROM authenticated;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.next_exhibition_order_id() TO service_role;
