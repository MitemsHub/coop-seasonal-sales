-- migrations/restore-exhibition-catalogue-three-statuses.sql
-- Restores the catalogue that was retired when the exhibition became
-- invoice-only, and locks the exhibition order pipeline to:
--
--   Pending -> Approved -> Confirmed
--   Cancelled is the exception (and can be restored to Pending).
--
-- Delivered is intentionally removed. Existing Delivered rows are folded into
-- the new model:
--   * already member-confirmed -> Confirmed
--   * not member-confirmed     -> Approved (the member can still confirm)
--
-- Safe to run more than once.

-- ── Catalogue ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exhibition_categories (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES exhibition_cycles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, name)
);

CREATE TABLE IF NOT EXISTS exhibition_products (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES exhibition_cycles(id) ON DELETE CASCADE,
  vendor_id BIGINT NOT NULL REFERENCES exhibition_vendors(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  category_id BIGINT NULL REFERENCES exhibition_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'each',
  vendor_price BIGINT NOT NULL DEFAULT 0,
  qty INTEGER NULL,
  image_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('approved', 'pending', 'rejected')),
  approval_note TEXT NOT NULL DEFAULT '',
  approval_requested_at TIMESTAMPTZ NULL,
  approval_reviewed_at TIMESTAMPTZ NULL,
  pending_vendor_price NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, vendor_id, sku)
);

-- The table may already exist in an environment where only parts of the
-- catalogue were dropped. Add the columns the restored code expects.
ALTER TABLE exhibition_products
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approval_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS approval_reviewed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pending_vendor_price NUMERIC NULL;

-- The exhibition has no co-op markup: the vendor price is the member price.
-- Drop the columns from older installations so inserts cannot leave stale
-- markup values behind.
ALTER TABLE exhibition_products
  DROP COLUMN IF EXISTS admin_markup,
  DROP COLUMN IF EXISTS pending_admin_markup;

CREATE INDEX IF NOT EXISTS exhibition_products_vendor_idx ON exhibition_products(vendor_id);
CREATE INDEX IF NOT EXISTS exhibition_products_branch_idx ON exhibition_products(branch_id);
CREATE INDEX IF NOT EXISTS exhibition_products_category_idx ON exhibition_products(category_id);
CREATE INDEX IF NOT EXISTS exhibition_products_status_idx ON exhibition_products(status);
CREATE INDEX IF NOT EXISTS exhibition_products_approval_status_idx
  ON exhibition_products (approval_status, approval_requested_at DESC);

-- Every price edit, by vendor or admin, with the values before and after.
CREATE TABLE IF NOT EXISTS exhibition_price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES exhibition_products(id) ON DELETE CASCADE,
  cycle_id BIGINT NULL,
  vendor_id BIGINT NULL,
  old_vendor_price BIGINT NULL,
  new_vendor_price BIGINT NULL,
  changed_by TEXT NOT NULL DEFAULT '',
  changed_by_label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE exhibition_price_history
  DROP COLUMN IF EXISTS old_admin_markup,
  DROP COLUMN IF EXISTS new_admin_markup;

CREATE INDEX IF NOT EXISTS exhibition_price_history_product_idx
  ON exhibition_price_history(product_id, created_at DESC);

-- Cart holds: a member's active cart reserves units for ten minutes. Checkout
-- still decrements the real stock atomically through exhibition_reserve_stock.
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

ALTER TABLE exhibition_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE exhibition_stock_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE exhibition_stand_follows ENABLE ROW LEVEL SECURITY;

-- ── Order lines can point at a catalogue product again ─────────────────
-- Manual invoices keep product_id NULL; shop orders fill it in.
ALTER TABLE exhibition_order_lines
  ADD COLUMN IF NOT EXISTS product_id BIGINT REFERENCES exhibition_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exhibition_order_lines_product_idx
  ON exhibition_order_lines(product_id);

-- ── The three-status pipeline ──────────────────────────────────────────
ALTER TABLE exhibition_orders DROP CONSTRAINT IF EXISTS exhibition_orders_status_check;

ALTER TABLE exhibition_orders
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS member_confirmed_at TIMESTAMPTZ NULL;

UPDATE exhibition_orders
   SET status = 'Confirmed',
       member_confirmed_at = COALESCE(member_confirmed_at, NOW()),
       updated_at = NOW()
 WHERE status = 'Delivered'
   AND member_confirmed_at IS NOT NULL;

UPDATE exhibition_orders
   SET status = 'Approved',
       delivered_at = NULL,
       updated_at = NOW()
 WHERE status = 'Delivered';

ALTER TABLE exhibition_orders
  ADD CONSTRAINT exhibition_orders_status_check
  CHECK (status IN ('Pending', 'Approved', 'Confirmed', 'Cancelled'));

-- Who confirmed (member portal or an admin override), for the audit trail.
ALTER TABLE exhibition_orders
  ADD COLUMN IF NOT EXISTS confirmed_by_role TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS confirmed_by_code TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS exhibition_orders_awaiting_confirmation_idx;
CREATE INDEX IF NOT EXISTS exhibition_orders_awaiting_confirmation_idx
  ON exhibition_orders (approved_at)
  WHERE status = 'Approved';

-- ── Atomic stock reservation / release ─────────────────────────────────
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
       SET qty = CASE WHEN qty IS NULL THEN NULL ELSE qty + v_qty END,
           updated_at = NOW()
     WHERE id = v_product_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

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

-- Verification:
--   SELECT status, COUNT(*) FROM exhibition_orders GROUP BY status;
--   SELECT count(*) FROM exhibition_products;
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint WHERE conname = 'exhibition_orders_status_check';
