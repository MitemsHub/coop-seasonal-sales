-- migrations/add-exhibition-product-approval-review-fields.sql
-- The approval API reads and writes the rejection note and review timestamp.
-- These columns were present in production but missing from the committed
-- product-approval migration, so fresh databases failed when an admin
-- approved or rejected a vendor product.

ALTER TABLE exhibition_products
  ADD COLUMN IF NOT EXISTS approval_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approval_reviewed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN exhibition_products.approval_note IS
  'Admin feedback shown to the vendor when a product or price change is rejected.';
COMMENT ON COLUMN exhibition_products.approval_reviewed_at IS
  'When an admin last approved or rejected the product or pending price.';
