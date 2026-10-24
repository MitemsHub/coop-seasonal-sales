-- fix-advisor-quick-wins.sql
-- Step 1 of the Supabase advisor cleanup for the Disk IO issue. APPLIED on the
-- live project 2026-10-24 (see scripts/apply-advisor-quick-wins.mjs, which
-- executed this change set onto the production database with pre-pull
-- backups; this file is the versioned record).
--
-- A) Every public function with a mutable search_path (advisor security
--    rule) got its search_path pinned to public. Behavior-preserving:
--    unqualified names resolve exactly as before, the path is simply no
--    longer overridable per session.
-- B) All 13 truly redundant duplicate indexes were dropped with
--    DROP INDEX CONCURRENTLY. In every group the keeper was the most-used
--    index, or the constraint-backed one where applicable. Definitions of
--    everything dropped are preserved in
--    scripts/advisor-quick-wins-index-backup-2026-10-24T03-56-24.{json,sql}.
--
-- Not included here (deliberately): RLS enablement on the 48 open tables —
-- that is Step 2 and needs per-table policies so the browser-side pages keep
-- working. The 11 backup_* leftovers are a separate cleanup decision.

-- ── A) Pin search_path on the 20 flagged functions ──────────────────────
ALTER FUNCTION public.cancel_order(bigint, text) SET search_path = public;
ALTER FUNCTION public.check_exhibition_exposure_atomic(text, text, numeric, integer) SET search_path = public;
ALTER FUNCTION public.check_ram_exposure_atomic(text, text, numeric, integer, integer) SET search_path = public;
ALTER FUNCTION public.check_ram_exposure_atomic(text, text, numeric, integer) SET search_path = public;
ALTER FUNCTION public.create_food_order_atomic(text, text, text, integer, integer, integer, text, numeric, integer, jsonb, boolean, numeric) SET search_path = public;
ALTER FUNCTION public.deliver_order(integer, text) SET search_path = public;
ALTER FUNCTION public.exhibition_release_stock(jsonb) SET search_path = public;
ALTER FUNCTION public.exhibition_reserve_stock(jsonb) SET search_path = public;
ALTER FUNCTION public.get_active_cycle_id() SET search_path = public;
ALTER FUNCTION public.get_active_ram_cycle_id() SET search_path = public;
ALTER FUNCTION public.on_branch_item_markups_changed() SET search_path = public;
ALTER FUNCTION public.on_branch_item_prices_changed() SET search_path = public;
ALTER FUNCTION public.post_order(integer, text) SET search_path = public;
ALTER FUNCTION public.post_orders_bulk(integer[], text) SET search_path = public;
ALTER FUNCTION public.refresh_inventory_status() SET search_path = public;
ALTER FUNCTION public.set_cycle_id_from_active_cycle() SET search_path = public;
ALTER FUNCTION public.set_exhibition_updated_at() SET search_path = public;
ALTER FUNCTION public.set_ram_cycle_id_from_active_cycle() SET search_path = public;
ALTER FUNCTION public.update_order_lines_batch(integer, json, integer) SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

-- ── B) Drop the 13 redundant duplicate indexes ──────────────────────────
DROP INDEX CONCURRENTLY IF EXISTS public.idx_branch_item_prices_item_performance;      -- keeper: idx_branch_item_prices_item_id
DROP INDEX CONCURRENTLY IF EXISTS public.idx_bip_branch_item;                          -- keeper: idx_branch_item_prices_branch_item
DROP INDEX CONCURRENTLY IF EXISTS public.idx_v_inventory_status_branch_item;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_branch_item_prices_branch_item_performance;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_branch_item_prices_branch_item_cycle;     -- keeper: uq_branch_item_cycle (constraint-backed)
DROP INDEX CONCURRENTLY IF EXISTS public.idx_items_sku_performance;                    -- keeper: idx_items_sku
DROP INDEX CONCURRENTLY IF EXISTS public.idx_items_category_performance;               -- keeper: idx_items_category
DROP INDEX CONCURRENTLY IF EXISTS public.idx_order_lines_item_id_performance;          -- keeper: idx_order_lines_item_id
DROP INDEX CONCURRENTLY IF EXISTS public.idx_order_lines_order;                        -- keeper: idx_order_lines_order_id
DROP INDEX CONCURRENTLY IF EXISTS public.idx_order_lines_order_id_performance;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_member;                            -- keeper: idx_orders_member_id
DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_member_id_performance;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_branch_status_performance;         -- keeper: idx_orders_branch_status
