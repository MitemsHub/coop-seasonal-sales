-- migrations/exhibition-counter-invoices.sql
-- 2026 exhibition: the sale happens at the stand. The vendor keys the invoice
-- while the member waits, so a line no longer has to point at a catalogue
-- product. Nothing is deleted — storefront orders keep working.
--
-- Safe to run more than once.

-- 1. A line can exist without a product (physical goods, keyed at the counter).
ALTER TABLE exhibition_order_lines ALTER COLUMN product_id DROP NOT NULL;

-- 2. Where the order came from, and who captured / last edited it.
ALTER TABLE exhibition_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'storefront';
ALTER TABLE exhibition_orders ADD COLUMN IF NOT EXISTS captured_by_role TEXT NOT NULL DEFAULT '';
ALTER TABLE exhibition_orders ADD COLUMN IF NOT EXISTS captured_by_code TEXT NOT NULL DEFAULT '';
ALTER TABLE exhibition_orders ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ NULL;
ALTER TABLE exhibition_orders ADD COLUMN IF NOT EXISTS last_edited_by_role TEXT NOT NULL DEFAULT '';
ALTER TABLE exhibition_orders ADD COLUMN IF NOT EXISTS last_edited_by_code TEXT NOT NULL DEFAULT '';
ALTER TABLE exhibition_orders ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE exhibition_orders DROP CONSTRAINT IF EXISTS exhibition_orders_source_check;
ALTER TABLE exhibition_orders
  ADD CONSTRAINT exhibition_orders_source_check
  CHECK (source IN ('storefront', 'counter', 'admin'));

-- 3. A short free-text note per line ("blue, size 42") entered at the counter.
ALTER TABLE exhibition_order_lines ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS exhibition_orders_source_idx ON exhibition_orders(source);

-- Verification (run after applying):
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE table_name = 'exhibition_order_lines' AND column_name = 'product_id';
--   SELECT source, COUNT(*) FROM exhibition_orders GROUP BY source;
