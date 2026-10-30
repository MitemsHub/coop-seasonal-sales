-- Migration: freeze the identity of items that already carry order history.
--
-- Why (leak reported 2026-10-30): a member opened their cycle-1 order and saw
-- "Fresh Red Oil 5L" — a product other members also reported seeing where they
-- did not expect it. Receipts render the LIVE items row:
--     app/api/orders/[id]/route.js        order_lines(..., items:item_id(sku, name))
--     app/api/members/orders/route.js     order_lines(..., items:item_id(sku,name))
--     app/api/admin/food/orders/[id]      order_lines(..., items:item_id(sku, name))
-- so anything that rewrites items.name rewrites every historical receipt that
-- points at that row. That has already happened: scripts/repair-crosslink-
-- 2026-10-20.mjs documents item #3 being "renamed away from its real identity"
-- until it landed on "Fresh Red Oil 5L" / FRESHREDOIL5L-2, its image_url was
-- re-written at 2026-10-20T02:31:10Z, and 165 cycle-1 order lines still point
-- at that row — 165 receipts whose item text is whatever the catalogue says
-- TODAY, not what the member bought.
--
-- Rule enforced here: once an item appears on an order line of a CLOSED cycle,
-- its member-facing identity (name / unit / category / image) is immutable.
-- Fixes still work while the item only has active-cycle lines (that is how the
-- Lafia "Tin Tomato Sarah" typo was corrected). After the cycle closes, the
-- correct move is to create a new item and retire this one — which is already
-- the RETIRED-<sku> convention.
--
-- is_active and sku are deliberately NOT guarded: the cancel/restore flow
-- re-homes the SKU to a RETIRED- tombstone, and retiring a product must stay
-- possible forever.
--
-- APPLY: Supabase SQL Editor (idempotent, no data is rewritten).
BEGIN;

CREATE OR REPLACE FUNCTION public.protect_historical_item_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_closed TEXT;
BEGIN
  -- No-op UPDATEs (re-imports that write the same values) always pass.
  IF NEW.name      IS NOT DISTINCT FROM OLD.name
     AND NEW.unit  IS NOT DISTINCT FROM OLD.unit
     AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(DISTINCT cy.code, ', ' ORDER BY cy.code)
    INTO v_closed
    FROM public.order_lines ol
    JOIN public.orders o   ON o.order_id = ol.order_id
    JOIN public.cycles cy  ON cy.id = o.cycle_id
   WHERE ol.item_id = OLD.item_id
     AND COALESCE(cy.is_active, FALSE) = FALSE;

  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION
      'Item % (%) already appears on orders in closed cycle(s) %, so its name/unit/category/image cannot be edited in place — that would rewrite those receipts. Create a new item and retire this one instead.',
      OLD.item_id, OLD.name, v_closed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_historical_item_identity ON public.items;
CREATE TRIGGER trg_protect_historical_item_identity
BEFORE UPDATE OF name, unit, category, image_url ON public.items
FOR EACH ROW
EXECUTE FUNCTION public.protect_historical_item_identity();

COMMENT ON FUNCTION public.protect_historical_item_identity() IS
  'Blocks in-place identity edits on items that already appear on closed-cycle orders (receipts render the live item row).';

COMMIT;
