-- =====================================================================
-- Coop Exhibition module
-- Seasonal, annual, recurring. Each branch runs its own exhibition with
-- its own vendor set. Members order (one order, lines tagged per vendor),
-- reps approve/cancel, vendors hand over goods and mark delivered, admin
-- is superuser. Members pay via Cash/Savings/Loan; the co-op pays vendors
-- later (mirrors the Ram vendor-payment flow).
-- =====================================================================

-- ── Cycles: one exhibition season per branch ──────────────────────────
CREATE TABLE IF NOT EXISTS exhibition_cycles (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  vendor_deduction_rate_pct NUMERIC(6, 2) NOT NULL DEFAULT 6,
  loan_interest_rate_pct NUMERIC(6, 2) NOT NULL DEFAULT 13,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exhibition_cycles_branch_idx ON exhibition_cycles(branch_id);
CREATE INDEX IF NOT EXISTS exhibition_cycles_status_idx ON exhibition_cycles(status);

-- ── Vendors: belong to a branch + cycle, login with code + passcode ───
CREATE TABLE IF NOT EXISTS exhibition_vendors (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES exhibition_cycles(id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  passcode TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exhibition_vendors_branch_idx ON exhibition_vendors(branch_id);
CREATE INDEX IF NOT EXISTS exhibition_vendors_cycle_idx ON exhibition_vendors(cycle_id);
CREATE INDEX IF NOT EXISTS exhibition_vendors_status_idx ON exhibition_vendors(status);

-- ── Categories: per-cycle catalog taxonomy ────────────────────────────
CREATE TABLE IF NOT EXISTS exhibition_categories (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES exhibition_cycles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, name)
);

-- ── Products ──────────────────────────────────────────────────────────
-- final member price = vendor_price + admin_markup,
-- overridden per member by exhibition_member_prices when present.
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
  admin_markup BIGINT NOT NULL DEFAULT 0,
  qty INTEGER NULL,
  image_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, vendor_id, sku)
);

CREATE INDEX IF NOT EXISTS exhibition_products_vendor_idx ON exhibition_products(vendor_id);
CREATE INDEX IF NOT EXISTS exhibition_products_branch_idx ON exhibition_products(branch_id);
CREATE INDEX IF NOT EXISTS exhibition_products_category_idx ON exhibition_products(category_id);
CREATE INDEX IF NOT EXISTS exhibition_products_status_idx ON exhibition_products(status);

-- ── Per-member negotiated prices (the person who beats the price wins) ─
CREATE TABLE IF NOT EXISTS exhibition_member_prices (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES exhibition_cycles(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES exhibition_products(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
  price BIGINT NOT NULL DEFAULT 0,
  set_by TEXT NOT NULL DEFAULT 'vendor' CHECK (set_by IN ('vendor', 'admin', 'rep')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, product_id, member_id)
);

CREATE INDEX IF NOT EXISTS exhibition_member_prices_product_idx ON exhibition_member_prices(product_id);
CREATE INDEX IF NOT EXISTS exhibition_member_prices_member_idx ON exhibition_member_prices(member_id);

-- ── Orders: one order, lines tagged per vendor ────────────────────────
CREATE TABLE IF NOT EXISTS exhibition_orders (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  cycle_id BIGINT NOT NULL REFERENCES exhibition_cycles(id) ON DELETE RESTRICT,
  branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES members(member_id) ON DELETE RESTRICT,
  member_name_snapshot TEXT NOT NULL DEFAULT '',
  payment_option TEXT NOT NULL CHECK (payment_option IN ('Cash', 'Loan', 'Savings')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Delivered', 'Cancelled')),
  total_qty INTEGER NOT NULL DEFAULT 0,
  total_amount BIGINT NOT NULL DEFAULT 0,
  approved_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_reason TEXT NOT NULL DEFAULT '',
  restored_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exhibition_orders_member_idx ON exhibition_orders(member_id);
CREATE INDEX IF NOT EXISTS exhibition_orders_status_idx ON exhibition_orders(status);
CREATE INDEX IF NOT EXISTS exhibition_orders_cycle_idx ON exhibition_orders(cycle_id);
CREATE INDEX IF NOT EXISTS exhibition_orders_branch_idx ON exhibition_orders(branch_id);

CREATE TABLE IF NOT EXISTS exhibition_order_lines (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES exhibition_orders(id) ON DELETE CASCADE,
  vendor_id BIGINT NOT NULL REFERENCES exhibition_vendors(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES exhibition_products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'each',
  vendor_price BIGINT NOT NULL DEFAULT 0,
  final_price BIGINT NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 0,
  amount BIGINT NOT NULL DEFAULT 0,
  delivered BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exhibition_order_lines_order_idx ON exhibition_order_lines(order_id);
CREATE INDEX IF NOT EXISTS exhibition_order_lines_vendor_idx ON exhibition_order_lines(vendor_id);

-- ── Vendor payout tracking (co-op pays vendors after the exhibition) ──
CREATE TABLE IF NOT EXISTS exhibition_vendor_payment_status (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES exhibition_cycles(id) ON DELETE CASCADE,
  vendor_id BIGINT NOT NULL REFERENCES exhibition_vendors(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES exhibition_orders(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL DEFAULT 0,
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS exhibition_vendor_payment_vendor_idx ON exhibition_vendor_payment_status(vendor_id);
CREATE INDEX IF NOT EXISTS exhibition_vendor_payment_paid_idx ON exhibition_vendor_payment_status(paid);

-- ── Shared updated_at trigger ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_exhibition_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exhibition_cycles_updated_at ON exhibition_cycles;
CREATE TRIGGER trg_exhibition_cycles_updated_at
BEFORE UPDATE ON exhibition_cycles
FOR EACH ROW EXECUTE FUNCTION set_exhibition_updated_at();

DROP TRIGGER IF EXISTS trg_exhibition_vendors_updated_at ON exhibition_vendors;
CREATE TRIGGER trg_exhibition_vendors_updated_at
BEFORE UPDATE ON exhibition_vendors
FOR EACH ROW EXECUTE FUNCTION set_exhibition_updated_at();

DROP TRIGGER IF EXISTS trg_exhibition_products_updated_at ON exhibition_products;
CREATE TRIGGER trg_exhibition_products_updated_at
BEFORE UPDATE ON exhibition_products
FOR EACH ROW EXECUTE FUNCTION set_exhibition_updated_at();

DROP TRIGGER IF EXISTS trg_exhibition_member_prices_updated_at ON exhibition_member_prices;
CREATE TRIGGER trg_exhibition_member_prices_updated_at
BEFORE UPDATE ON exhibition_member_prices
FOR EACH ROW EXECUTE FUNCTION set_exhibition_updated_at();

DROP TRIGGER IF EXISTS trg_exhibition_orders_updated_at ON exhibition_orders;
CREATE TRIGGER trg_exhibition_orders_updated_at
BEFORE UPDATE ON exhibition_orders
FOR EACH ROW EXECUTE FUNCTION set_exhibition_updated_at();
