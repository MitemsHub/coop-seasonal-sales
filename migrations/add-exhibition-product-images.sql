-- migrations/add-exhibition-product-images.sql
-- Vendors may upload more than one photo for a product. The first photo is the
-- cover (and is mirrored into image_url so the cart, orders and invoices keep
-- working unchanged); the rest drive the shop carousel and the view popup.
-- Safe to run more than once.

ALTER TABLE exhibition_products
  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN exhibition_products.image_urls IS
  'Ordered list of product photo URLs. image_url always mirrors the first entry.';
