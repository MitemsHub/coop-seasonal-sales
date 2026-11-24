-- migrations/add-order-removal-snapshots.sql
-- Bulk "remove items from orders" deletes order_lines outright, so a mistaken
-- SKU/branch/cycle paste used to be unrecoverable without re-adding every line
-- by hand at today's price. Each run now writes one snapshot row here first:
-- the exact line rows it deletes and the order state they were taken from, so
-- the removal can be restored (lines, totals and a cancelled order's status).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS order_removal_snapshots (
  id BIGSERIAL PRIMARY KEY,
  module TEXT NOT NULL DEFAULT 'food',
  actor TEXT NOT NULL DEFAULT '',
  branch_code TEXT NOT NULL DEFAULT '',
  branch_id BIGINT NULL,
  cycle_id BIGINT NULL,
  requested_skus JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  retired_skus JSONB NOT NULL DEFAULT '[]'::jsonb,
  removed_lines INTEGER NOT NULL DEFAULT 0,
  affected_orders INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ NULL,
  restored_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS order_removal_snapshots_created_idx
  ON order_removal_snapshots (created_at DESC);

-- Server routes use the service role, which bypasses RLS. Locking the table
-- keeps it out of any anon/authenticated direct access.
ALTER TABLE order_removal_snapshots ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE order_removal_snapshots IS
  'Copy of the order lines a bulk item removal deleted, with the order state needed to restore them.';
