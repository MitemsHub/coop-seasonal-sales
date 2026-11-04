-- Cart holds, stand follows and the ready-for-pickup stamp.
--
--   exhibition_stock_holds  a member's cart reserves units for 10 minutes so
--                           two people cannot both pay for the last one. The
--                           real decrement still happens atomically when the
--                           order is created (exhibition_reserve_stock).
--   exhibition_stand_follows who wants to hear when a stand lists something new
--   exhibition_orders.ready_at  when the order was cleared for collection
--
-- Safe to re-run.

ALTER TABLE exhibition_orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS exhibition_stock_holds (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES exhibition_cycles(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES exhibition_products(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exhibition_stock_holds_product_idx
  ON exhibition_stock_holds(product_id, expires_at);
CREATE INDEX IF NOT EXISTS exhibition_stock_holds_member_idx
  ON exhibition_stock_holds(member_id);

CREATE TABLE IF NOT EXISTS exhibition_stand_follows (
  id BIGSERIAL PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
  vendor_id BIGINT NOT NULL REFERENCES exhibition_vendors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS exhibition_stand_follows_vendor_idx
  ON exhibition_stand_follows(vendor_id);

-- Server-only tables: no anon/authenticated policies, the service role used by
-- the API routes bypasses RLS.
ALTER TABLE exhibition_stock_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE exhibition_stand_follows ENABLE ROW LEVEL SECURITY;
