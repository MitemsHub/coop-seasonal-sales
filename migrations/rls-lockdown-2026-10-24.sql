-- =============================================================
-- RLS lockdown — PHASE 1 — coop-seasonal-sales
-- Generated 2026-10-24
--
-- Model (matches how the app actually talks to the database):
--   * Browser pages use NEXT_PUBLIC_SUPABASE_ANON_KEY for catalog
--     reads (items, taxonomy, overrides, branches, departments,
--     cycles, markups, prices) and Realtime *broadcast/presence*
--     chat channels (not table reads — unaffected by RLS).
--   * Every privileged query goes through API routes that validate
--     the session cookie themselves and use SUPABASE_SERVICE_ROLE_KEY
--     (BYPASSRLS) — so enabling RLS with no public policies is
--     deny-all for anon and a no-op for the server.
--
-- PHASE 1 scope (zero browser dependency):
--   * Deny-all (enable RLS + force + no anon policy) on:
--       app_settings, audit_log, chat_messages, inventory_movements,
--       grade_limits, low_stock_alerts,
--       food_vendor_bank_accounts/food_vendor_invoices/food_vendor_payment_status,
--       exhibition_categories, exhibition_cycles, exhibition_member_prices,
--       exhibition_order_lines, exhibition_orders, exhibition_products,
--       exhibition_vendors, exhibition_vendor_bank_accounts,
--       exhibition_vendor_invoices, exhibition_vendor_payment_status,
--       ram_cycle_delivery_locations, ram_vendor_bank_accounts,
--       ram_vendor_invoices, ram_vendor_payment_status
--   * Public catalog SELECT on: items, item_taxonomy,
--     item_branch_overrides, branches, departments, cycles,
--     branch_item_markups, branch_item_prices
--   * Drop every remaining backup_* scratch table (verified: no
--     views/functions/FKs/triggers reference any of them).
--
-- PHASE 2 (separate migration, after the 8 affected pages get server
-- API routes): members, orders, order_lines, ram_orders, ram_cycles,
-- ram_delivery_locations + the v_inventory_status view exposure.
--   Currently-open browser reads found in: app/cart, app/my-coop,
--   app/orders, app/ram/shop, app/ram/success/[id], app/shop,
--   app/admin/food/cart, app/admin/food/orders.
--
-- Idempotent: safe to run more than once.
-- =============================================================

BEGIN;

-- ---------- 1) Deny-all: enable + FORCE RLS on server-only tables ----------
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'app_settings','audit_log','chat_messages','inventory_movements',
    'grade_limits','low_stock_alerts','member_notifications',
    'food_vendor_bank_accounts','food_vendor_invoices','food_vendor_payment_status',
    'exhibition_categories','exhibition_cycles','exhibition_member_prices',
    'exhibition_order_lines','exhibition_orders','exhibition_products',
    'exhibition_vendors','exhibition_vendor_bank_accounts',
    'exhibition_vendor_invoices','exhibition_vendor_payment_status',
    'ram_cycle_delivery_locations',
    'ram_vendor_bank_accounts','ram_vendor_invoices','ram_vendor_payment_status'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- ---------- 2) Drop every pre-existing policy on ALL produced tables ----------
-- (Both deny-all tables and catalog tables — we re-create the small
-- public-read surface explicitly below.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN (
               'app_settings','audit_log','chat_messages','inventory_movements',
               'grade_limits','low_stock_alerts',
               'food_vendor_bank_accounts','food_vendor_invoices','food_vendor_payment_status',
               'exhibition_categories','exhibition_cycles','exhibition_member_prices',
               'exhibition_order_lines','exhibition_orders','exhibition_products',
               'exhibition_vendors','exhibition_vendor_bank_accounts',
               'exhibition_vendor_invoices','exhibition_vendor_payment_status',
               'ram_cycle_delivery_locations',
               'ram_vendor_bank_accounts','ram_vendor_invoices','ram_vendor_payment_status',
               'items','item_taxonomy','item_branch_overrides','branches','departments',
               'cycles','branch_item_markups','branch_item_prices'
             )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ---------- 3) Public catalog SELECTs (the ONLY anon-visible surface) ----------
CREATE POLICY "public_read_items"       ON public.items                 FOR SELECT TO public USING (true);
CREATE POLICY "public_read_taxonomy"    ON public.item_taxonomy         FOR SELECT TO public USING (true);
CREATE POLICY "public_read_overrides"   ON public.item_branch_overrides FOR SELECT TO public USING (true);
CREATE POLICY "public_read_branches"    ON public.branches              FOR SELECT TO public USING (true);
CREATE POLICY "public_read_departments" ON public.departments           FOR SELECT TO public USING (true);
CREATE POLICY "public_read_cycles"      ON public.cycles                FOR SELECT TO public USING (true);
CREATE POLICY "public_read_markups"     ON public.branch_item_markups   FOR SELECT TO public USING (true);
CREATE POLICY "public_read_prices"      ON public.branch_item_prices    FOR SELECT TO public USING (true);

-- Enable RLS + FORCE on the catalog tables too (already needed for FORCE).
DO $$
DECLARE tbl text;

BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'items','item_taxonomy','item_branch_overrides','branches','departments',
    'cycles','branch_item_markups','branch_item_prices'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- ---------- 4) Drop every remaining backup_* scratch table ----------
-- Verified: no views, functions, FKs, or triggers reference any of them;
-- they are unmaintained data snapshots from earlier harmonize runs.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT relname FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname LIKE 'backup\_%' ESCAPE '\'
             AND c.relkind = 'r'
  LOOP
    RAISE NOTICE 'dropping backup table: %', r.relname;
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;
END $$;

COMMIT;
