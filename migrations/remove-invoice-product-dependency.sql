-- Counter invoices describe items by name, qty and price; they do not use the
-- catalogue product table. Drop the legacy foreign key so invoice creation is
-- independent of exhibition_products.
--
-- The nullable product_id column is retained for the paused member shopfront,
-- whose order writer still records catalogue ids. Counter invoices leave it null.
alter table exhibition_order_lines
  drop constraint if exists exhibition_order_lines_product_id_fkey;
