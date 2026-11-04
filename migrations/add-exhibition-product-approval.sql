-- migrations/add-exhibition-product-approval.sql
-- Vendor product approval for the Coop Exhibition.
--
-- A vendor's new product is created as a draft and only becomes visible to
-- members once an admin approves it. A price change on a live product is
-- stored as a pending request: the shop keeps selling at the approved price
-- until the admin approves the new one.
--
-- approval_status:
--   'approved' — live (or approved and later archived by the admin)
--   'pending'  — waiting for the admin (new product, or a price change)
--   'rejected' — the admin declined the product / price change
--
-- Existing rows are backfilled to 'approved' by the column default, so nothing
-- currently on sale disappears.

ALTER TABLE exhibition_products
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS pending_vendor_price NUMERIC,
  ADD COLUMN IF NOT EXISTS pending_admin_markup NUMERIC,
  ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ;

-- Admin queues read "pending, newest first".
CREATE INDEX IF NOT EXISTS exhibition_products_approval_status_idx
  ON exhibition_products (approval_status, approval_requested_at DESC);

COMMENT ON COLUMN exhibition_products.approval_status IS
  'approved | pending | rejected — vendor products and price changes need admin approval';
COMMENT ON COLUMN exhibition_products.pending_vendor_price IS
  'Proposed vendor price awaiting admin approval; live vendor_price stays in force until then';
