-- =====================================================================
-- Coop Exhibition — integrity constraints and hot-path indexes
-- Run AFTER add-coop-exhibition-module.sql and add-exhibition-stock-rpc.sql.
--
-- Everything here is defensive: the RPCs already guard stock at checkout, but
-- nothing stopped other writers (admin edits, scripts, migrations) from driving
-- qty negative, and nothing stopped two concurrent activations from leaving two
-- active cycles on one branch.
-- =====================================================================

-- ── Pre-flight checks ────────────────────────────────────────────────
-- Run these first. Any rows returned must be fixed before the matching
-- statement below will succeed.
--
--   SELECT id, name, qty FROM exhibition_products WHERE qty < 0;
--
--   SELECT branch_id, COUNT(*) FROM exhibition_cycles
--    WHERE status = 'active' GROUP BY branch_id HAVING COUNT(*) > 1;

-- ── 1. Stock can never go negative ───────────────────────────────────
-- NOT VALID enforces the rule for every new write without failing on legacy
-- rows. Run the VALIDATE statement once existing data is clean.
ALTER TABLE exhibition_products
  ADD CONSTRAINT exhibition_products_qty_nonneg
  CHECK (qty IS NULL OR qty >= 0) NOT VALID;

-- Uncomment after cleaning up historical negatives:
-- ALTER TABLE exhibition_products VALIDATE CONSTRAINT exhibition_products_qty_nonneg;

-- NOTE: lib/exhibitionStock.js checkOrdersStock() currently treats qty < 0 as
-- the signal that an external correction over-consumed a reservation. Once this
-- constraint is validated, that branch is unreachable (which is the intent —
-- the write now fails instead of silently overselling).

-- ── 2. One active cycle per branch, enforced by the database ─────────
CREATE UNIQUE INDEX IF NOT EXISTS exhibition_cycles_one_active_per_branch
  ON exhibition_cycles (branch_id)
  WHERE status = 'active';

-- ── 3. Indexes for the queries on the hot paths ──────────────────────
-- Catalog: products for a cycle, filtered by status.
CREATE INDEX IF NOT EXISTS exhibition_products_cycle_status_idx
  ON exhibition_products (cycle_id, status);

-- Checkout: cumulative loan total per member per cycle, and the 30s duplicate
-- guard (member + payment + status + created_at).
CREATE INDEX IF NOT EXISTS exhibition_orders_member_cycle_payment_idx
  ON exhibition_orders (member_id, cycle_id, payment_option);

CREATE INDEX IF NOT EXISTS exhibition_orders_member_status_created_idx
  ON exhibition_orders (member_id, status, created_at DESC);

-- Stock helpers load every line of a set of orders by order_id.
CREATE INDEX IF NOT EXISTS exhibition_order_lines_order_idx
  ON exhibition_order_lines (order_id);

-- Vendor dashboards and payouts read lines per vendor per cycle.
CREATE INDEX IF NOT EXISTS exhibition_order_lines_vendor_idx
  ON exhibition_order_lines (vendor_id);

-- Per-member negotiated prices are looked up by (cycle, member) on every
-- catalog request.
CREATE INDEX IF NOT EXISTS exhibition_member_prices_cycle_member_idx
  ON exhibition_member_prices (cycle_id, member_id);

-- Abandoned-order sweep scans Pending orders by age.
CREATE INDEX IF NOT EXISTS exhibition_orders_status_created_idx
  ON exhibition_orders (status, created_at);
