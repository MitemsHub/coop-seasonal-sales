-- migrations/add-exhibition-product-description.sql
-- Vendors may describe a product (what it is, size, ingredients, condition).
-- Optional: blank for products that do not need one. Safe to run more than once.

ALTER TABLE exhibition_products
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN exhibition_products.description IS
  'Vendor-written product description, shown in the shop under the product name.';