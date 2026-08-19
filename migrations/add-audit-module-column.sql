-- migrations/add-audit-module-column.sql
-- The shared audit_log table serves both the food and ram modules, but rows were
-- written without a module tag. Both modules use TEXT order_id (food stores
-- orders.order_id, ram stores String(ram_orders.id)), so the two can't be told
-- apart reliably by the audit row alone. This adds a module column and backfills
-- existing rows by resolving each order_id against the two order tables.
--
-- Going forward every writer tags module: 'food' | 'ram' explicitly.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS module TEXT;

-- Backfill: resolve against the real order tables first (authoritative).
UPDATE audit_log a
SET module = 'food'
WHERE a.module IS NULL
  AND EXISTS (SELECT 1 FROM orders o WHERE o.order_id = a.order_id);

UPDATE audit_log a
SET module = 'ram'
WHERE a.module IS NULL
  AND EXISTS (SELECT 1 FROM ram_orders r WHERE r.id::text = a.order_id);

-- Orphaned/legacy rows: fall back on the row shape.
-- cycle_id / delivery_branch_id only ever appear on food (admin) rows.
UPDATE audit_log SET module = 'food'
WHERE module IS NULL
  AND (cycle_id IS NOT NULL OR delivery_branch_id IS NOT NULL OR action IN ('post', 'rollback'));

-- Remaining orphaned rows are ram-shaped (approve/cancel/restore are ram-only actions).
UPDATE audit_log SET module = 'ram'
WHERE module IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_module_created_at ON audit_log(module, created_at);
