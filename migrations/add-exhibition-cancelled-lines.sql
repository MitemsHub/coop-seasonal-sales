-- migrations/add-exhibition-cancelled-lines.sql
-- A vendor cancelling an item used to DELETE the order line, so the restore the
-- vendor dialogs promised ("Only the co-op admin can restore a cancelled item")
-- had nothing left to act on. Withdrawn lines now land here first, in the same
-- transaction that removes them: the full snapshot of the line, the order it
-- belonged to, the interest rate that order was charged, who took it off and
-- why. The admin restores from this table and the order is recalculated from
-- whatever is live again.
--
-- restored_at / restored_line_id record when (and as which line) an item went
-- back, so the trail is complete and nothing can be restored twice.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS exhibition_cancelled_lines (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES exhibition_orders(id) ON DELETE CASCADE,
  line_id BIGINT NULL,
  cycle_id BIGINT NULL,
  vendor_id BIGINT NULL REFERENCES exhibition_vendors(id) ON DELETE SET NULL,
  vendor_code TEXT NOT NULL DEFAULT '',
  product_id BIGINT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'each',
  vendor_price BIGINT NOT NULL DEFAULT 0,
  final_price BIGINT NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 0,
  amount BIGINT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  order_status_before TEXT NOT NULL DEFAULT '',
  -- Interest this order was actually charged, so a restore gives back exactly
  -- the money the cancellation took away even if the season's rate changed.
  applied_rate_pct NUMERIC(9, 6) NOT NULL DEFAULT 0,
  cancelled_by TEXT NOT NULL DEFAULT '',
  cancelled_reason TEXT NOT NULL DEFAULT '',
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ NULL,
  restored_by TEXT NULL,
  restored_line_id BIGINT NULL
);

CREATE INDEX IF NOT EXISTS exhibition_cancelled_lines_order_idx
  ON exhibition_cancelled_lines (order_id);
CREATE INDEX IF NOT EXISTS exhibition_cancelled_lines_vendor_idx
  ON exhibition_cancelled_lines (vendor_id);
-- The admin order view asks for what is still off the order, per page of orders.
CREATE INDEX IF NOT EXISTS exhibition_cancelled_lines_open_idx
  ON exhibition_cancelled_lines (order_id)
  WHERE restored_at IS NULL;

-- Routes use the service role, which bypasses RLS; locking the table keeps it
-- out of anon/authenticated direct access.
ALTER TABLE exhibition_cancelled_lines ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE exhibition_cancelled_lines IS
  'Snapshot of exhibition order lines a vendor (or the admin desk) withdrew, with everything needed to put them back on the order.';
