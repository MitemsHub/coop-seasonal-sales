-- migrations/security-invoker-inventory-view-2026-10-25.sql
--
-- Resolves the remaining Supabase advisor CRITICAL finding:
--   "Security Definer View — public.v_inventory_status is defined with the
--    SECURITY DEFINER property"
--
-- Background: Phase 2 (rls-lockdown-2026-10-24-phase2.sql) intentionally left
-- this view as a definer because the deployed build's shop page read it
-- directly from the browser with the anon key. That gap is now closed —
-- app/shop/page.jsx fetches items through /api/items/prices (service-role)
-- instead — so the view can run as the invoking user like the other views.
--
-- Preconditions BEFORE applying (in this order!):
--   1. Deploy the build whose shop page uses /api/items/prices
--      (the bundle the anon client uses must no longer query this view).
--   2. Then apply this migration.
--
-- Effects:
--   * security_invoker = true: every caller now needs SELECT on the view's
--     underlying tables (branches, branch_item_prices, items, orders,
--     order_lines, inventory_movements). The service-role key (the only
--     caller: /api/items/prices, /api/admin/*, shopPrewarm) bypasses RLS, so
--     server consumers keep working unchanged.
--   * REVOKE anon SELECT: the anon role can no longer read order-demand
--     aggregates through the view (permission is denied on the underlying
--     tables, so the view effectively rejects anon reads either way — the
--     explicit revoke keeps the permission surface tidy).

ALTER VIEW public.v_inventory_status SET (security_invoker = true);

REVOKE SELECT ON public.v_inventory_status FROM anon;

-- Sanity checks (run manually after applying):
--   select options->>'security_invoker' AS invoker
--     from pg_views
--    where schemaname='public' and viewname='v_inventory_status';  -- expect true
--   -- server call still returns rows:
--   select count(*) from public.v_inventory_status limit 5;
--
-- Rollback (only if something unaddressed still reads it with the anon key —
-- this restores the advisor finding, so prefer fixing the caller instead):
--   GRANT SELECT ON public.v_inventory_status TO anon;
--   ALTER VIEW public.v_inventory_status SET (security_invoker = false);
