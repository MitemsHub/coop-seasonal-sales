-- Stand profiles, approval feedback, product insights and price history.
-- Safe to re-run.

-- What a stand tells members: where it is, when it is open, how to reach it.
ALTER TABLE exhibition_vendors
  ADD COLUMN IF NOT EXISTS banner_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stand_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hall TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS opening_hours TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS min_order BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pickup_instructions TEXT NOT NULL DEFAULT '';

-- Why a product was rejected/held, so the vendor knows what to fix.
ALTER TABLE exhibition_products
  ADD COLUMN IF NOT EXISTS approval_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approval_reviewed_at TIMESTAMPTZ NULL;

-- Views, add-to-cart and empty searches. Aggregated per vendor/product.
CREATE TABLE IF NOT EXISTS exhibition_events (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NULL,
  vendor_id BIGINT NULL,
  product_id BIGINT NULL,
  member_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'add', 'search')),
  query TEXT NOT NULL DEFAULT '',
  results INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exhibition_events_vendor_idx
  ON exhibition_events(vendor_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS exhibition_events_product_idx
  ON exhibition_events(product_id, event_type);
CREATE INDEX IF NOT EXISTS exhibition_events_search_idx
  ON exhibition_events(event_type, results, created_at DESC);

-- Every price edit, by vendor or admin, with the values before and after.
CREATE TABLE IF NOT EXISTS exhibition_price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES exhibition_products(id) ON DELETE CASCADE,
  cycle_id BIGINT NULL,
  vendor_id BIGINT NULL,
  old_vendor_price BIGINT NULL,
  new_vendor_price BIGINT NULL,
  old_admin_markup BIGINT NULL,
  new_admin_markup BIGINT NULL,
  changed_by TEXT NOT NULL DEFAULT '',
  changed_by_label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exhibition_price_history_product_idx
  ON exhibition_price_history(product_id, created_at DESC);

ALTER TABLE exhibition_price_history ENABLE ROW LEVEL SECURITY;
