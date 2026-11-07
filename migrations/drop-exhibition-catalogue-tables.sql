-- The exhibition is counter-invoice only. These catalogue tables were all
-- empty and are no longer used by any page or API.
--
-- Check counts before running in another environment; this is destructive.
alter table exhibition_order_lines drop column if exists product_id;

drop table if exists exhibition_stock_holds cascade;
drop table if exists exhibition_product_addons cascade;
drop table if exists exhibition_price_history cascade;
drop table if exists exhibition_member_prices cascade;
drop table if exists exhibition_products cascade;
drop table if exists exhibition_categories cascade;
drop table if exists exhibition_stand_follows cascade;
