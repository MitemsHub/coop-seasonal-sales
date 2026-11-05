-- migrations/remove-exhibition-discount.sql
-- The exhibition "discount" (exhibition_products.admin_markup) is retired.
-- Members pay the vendor's listed price; a different price for one member is
-- set as a negotiated price in exhibition_member_prices, which is what the
-- admin Prices page and the vendor Prices page now drive.
--
-- The column is kept (not dropped) so exhibition_price_history rows stay
-- readable, but nothing in the app adds it to a price any more. Zeroing the
-- stored values keeps the table consistent with what members are charged.
--
-- Safe to re-run.

UPDATE exhibition_products SET admin_markup = 0 WHERE admin_markup <> 0;

UPDATE exhibition_products
   SET pending_admin_markup = NULL
 WHERE pending_admin_markup IS NOT NULL;
