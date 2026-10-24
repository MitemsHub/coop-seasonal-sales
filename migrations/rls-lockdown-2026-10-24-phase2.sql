-- =============================================================
-- RLS lockdown — PHASE 2 — coop-seasonal-sales
-- Generated 2026-10-24
--
-- Prerequisite: phase 2a code changes are deployed — the 8 pages that
-- used to read members / orders / order_lines / ram_* / v_master_sheet
-- with the browser anon key now go through server API routes:
--   /api/members/lookup, /api/cycles/active, /api/ram/order,
--   /api/admin/members/list, /api/admin/food/orders/all
--   (+ /api/ram/orders, /api/ram/delivery-locations already existed).
--
-- This migration:
--   1) Deny-all (RLS + FORCE, no anon policy) on the last 6 open tables:
--      members, orders, order_lines, ram_orders, ram_cycles,
--      ram_delivery_locations.
--   2) Sets security_invoker = true on the 12 member-PII views so they
--      no longer bypass RLS for the anon browser role (PG 17).
--   3) Revokes SELECT from anon/authenticated on those 12 views.
--   4) Leaves v_inventory_status as-is (definer view, but it exposes
--      ONLY branch/item aggregates — zero member PII — and the shop
--      page needs it. Verified column-by-column.)
--
-- Server-side API routes use SUPABASE_SERVICE_ROLE_KEY (BYPASSRLS +
-- default grants), so none of this affects admins, vendors or reps.
--
-- Idempotent: safe to run more than once.
-- =============================================================

BEGIN;

-- ---------- 1) Deny-all on the last 6 open tables ----------
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'members','orders','order_lines','ram_orders','ram_cycles','ram_delivery_locations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- Drop any pre-existing policies on those tables (fresh deny-all):
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('members','orders','order_lines','ram_orders',
                               'ram_cycles','ram_delivery_locations')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ---------- 2) security_invoker on the PII views (PG 17) ----------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_master_sheet','v_sheet_savings','v_sheet_loan','v_sheet_cash',
    'v_total_applications','v_total_unique_applicants',
    'v_applications_by_member_branch',
    'v_applications_by_delivery_branch_member_branch',
    'v_applications_by_branch','v_applications_by_branch_department',
    'v_applications_by_category','v_inventory_status_by_department'
  ] LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
  END LOOP;
END $$;

-- ---------- 3) Revoke anon/authenticated SELECT on those views ----------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_master_sheet','v_sheet_savings','v_sheet_loan','v_sheet_cash',
    'v_total_applications','v_total_unique_applicants',
    'v_applications_by_member_branch',
    'v_applications_by_delivery_branch_member_branch',
    'v_applications_by_branch','v_applications_by_branch_department',
    'v_applications_by_category','v_inventory_status_by_department'
  ] LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v);
    EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', v);
  END LOOP;
END $$;

-- ---------- 4) Explicit grant: the shop still needs inventory aggregates ----------
GRANT SELECT ON public.v_inventory_status TO anon;

-- ---------- 5) Final safety net: any table STILL without RLS fails loudly ----------
DO $$
DECLARE
  unprotected text := '';
  r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    unprotected := unprotected || r.relname || ' ';
  END LOOP;
  IF unprotected <> '' THEN
    RAISE EXCEPTION 'RLS LOCKDOWN FAILED — tables still unprotected: %', unprotected;
  END IF;
END $$;

COMMIT;
