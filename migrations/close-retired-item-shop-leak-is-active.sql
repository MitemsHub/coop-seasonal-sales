-- Migration: close the retired-item shop leak in v_inventory_status
-- Reviewed on 2026-10-23. The shop (`/shop`, `/api/items/prices`,
-- `lib/shopPrewarm.js`, admin item mirror in `/api/admin/items`) reads
-- `v_inventory_status`, whose only filter is `bip.price IS NOT NULL`.
-- Retired items (items.is_active = false) that still carry legacy branch
-- prices therefore still render in the shop.
--
-- Fix: recreate the view with the exact same shape/columns and add
-- `i.is_active` to the WHERE clause. No column is added, re-ordered or
-- re-typed, so CREATE OR REPLACE VIEW is safe for every consumer.
--
-- Retired items that currently leak into the view (verified live):
--   • Gino Tin Tomatoes       (RETIRED-GINOTINTOMATOES)        — priced in 6 branch rows
--   • Indomietable Noodles    (INDOMIETABLESNOODLES)           — priced in 4 branch rows
--   • Auntie B Spaghetti      (SPAGHETTIAB)                    — priced in 2 branch rows
--   • Mellait Milk Bag        (RETIRED-MELLAITMILKBAG-2)       — priced in 1 branch row
--   (Fresh Red Oil 5L and Indomie Noodles Onion Chicken are retired but
--    carry no prices, so they never appeared in the view.)
--
-- APPLY: Supabase SQL Editor. Reversible by dropping the filter (the view
-- definition below is the live definition + one WHERE predicate).
BEGIN;

CREATE OR REPLACE VIEW public.v_inventory_status AS
WITH order_agg AS (
         SELECT o.cycle_id,
            o.delivery_branch_id AS branch_id,
            ol.item_id,
            sum(ol.qty) AS total_demand,
            sum(
                CASE
                    WHEN o.status = 'Pending'::order_status THEN ol.qty
                    ELSE 0
                END) AS pending_demand,
            sum(
                CASE
                    WHEN o.status = 'Posted'::order_status THEN ol.qty
                    ELSE 0
                END) AS confirmed_demand,
            sum(
                CASE
                    WHEN o.status = ANY (ARRAY['Pending'::order_status, 'Posted'::order_status]) THEN ol.qty
                    ELSE 0
                END) AS allocated_qty,
            sum(
                CASE
                    WHEN o.status = 'Delivered'::order_status THEN ol.qty
                    ELSE 0
                END) AS delivered_qty,
            sum(
                CASE
                    WHEN o.status = 'Posted'::order_status THEN ol.qty
                    ELSE 0
                END) AS pending_delivery_qty
           FROM order_lines ol
             JOIN orders o ON o.order_id = ol.order_id
          GROUP BY o.cycle_id, o.delivery_branch_id, ol.item_id
        ), movement_agg AS (
         SELECT inventory_movements.cycle_id,
            inventory_movements.branch_id,
            inventory_movements.item_id,
            sum(
                CASE
                    WHEN inventory_movements.movement_type::text = 'In'::text THEN inventory_movements.quantity
                    WHEN inventory_movements.movement_type::text = 'Out'::text THEN - inventory_movements.quantity
                    ELSE 0
                END) AS stock_qty
           FROM inventory_movements
          GROUP BY inventory_movements.cycle_id, inventory_movements.branch_id, inventory_movements.item_id
        )
 SELECT bip.cycle_id,
    b.code AS branch_code,
    b.name AS branch_name,
    b.demand_tracking_mode,
    i.item_id,
    i.sku,
    i.name AS item_name,
    i.unit,
    i.category,
    i.image_url,
    bip.price,
    COALESCE(oa.total_demand, 0::bigint) AS total_demand,
    COALESCE(oa.pending_demand, 0::bigint) AS pending_demand,
    COALESCE(oa.confirmed_demand, 0::bigint) AS confirmed_demand,
    COALESCE(oa.allocated_qty, 0::bigint) AS allocated_qty,
    COALESCE(oa.delivered_qty, 0::bigint) AS delivered_qty,
    COALESCE(oa.pending_delivery_qty, 0::bigint) AS pending_delivery_qty,
    COALESCE(oa.delivered_qty, 0::bigint) AS delivered_demand,
        CASE
            WHEN b.demand_tracking_mode = true THEN 999999::bigint
            ELSE GREATEST(0::bigint, COALESCE(ma.stock_qty, 0::bigint))
        END AS available_stock,
        CASE
            WHEN b.demand_tracking_mode = true THEN 999999::bigint
            ELSE GREATEST(0::bigint, COALESCE(ma.stock_qty, 0::bigint) - COALESCE(oa.total_demand, 0::bigint))
        END AS remaining_after_posted,
        CASE
            WHEN b.demand_tracking_mode = true THEN 999999::bigint
            ELSE GREATEST(0::bigint, COALESCE(ma.stock_qty, 0::bigint) - COALESCE(oa.delivered_qty, 0::bigint))
        END AS remaining_after_delivered
   FROM branches b
     JOIN branch_item_prices bip ON b.id = bip.branch_id
     JOIN items i ON i.item_id = bip.item_id
     LEFT JOIN order_agg oa ON oa.cycle_id = bip.cycle_id AND oa.branch_id = b.id AND oa.item_id = i.item_id
     LEFT JOIN movement_agg ma ON ma.cycle_id = bip.cycle_id AND ma.branch_id = b.id AND ma.item_id = i.item_id
  WHERE bip.price IS NOT NULL
    AND i.is_active;  -- close the retired-item leak: inactive items stay out of the shop

COMMENT ON VIEW public.v_inventory_status IS
  'Per-branch/cycle inventory status for the shop and admin mirroring; excludes retired items (items.is_active = false).';

COMMIT;
