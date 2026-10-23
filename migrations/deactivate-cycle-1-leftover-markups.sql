-- Migration: Deactivate leftover markup rows from retired cycles (cycle 1).
--
-- Live state verified 2026-10-23:
--   cycles:   1 = "2025 Q3 Distribution" (is_active = false, retired)
--             3 = "2026 Q3 Distribution" (is_active = TRUE, current)
--   branch_item_markups:
--             cycle 1 → 721 rows, all active = true   ← leftover, should be off
--             cycle 3 → 898 rows, all active = true   ← correct, leave untouched
--
-- Every consumer (`/shop`, `/api/orders`, `/api/items/prices`,
-- `lib/shopPrewarm.js`, the SQL repricer) filters markups by the active
-- cycle or by `active`, so idle cycle-1 rows are harmless today — but they
-- can be re-activated accidentally by replica/import tooling and they show
-- as live rows in data management/export tooling that ignores cycle_id.
-- This migration flips them to active = false and moves on.
--
-- Notes:
--  • The repricer trigger (trg_reprice_orders_on_bim_change) fires on
--    UPDATE OF active, but it only reprices orders joining on the SAME
--    cycle_id (cycle 1), which is retired — no member-facing change.
--  • Idempotent: rows already active = false are skipped.
--  • Do NOT delete rows; order lines in cycle 1 recorded base + markup and
--    history should stay intact.
--
-- APPLY: Supabase SQL Editor. Wrapped in a transaction.
BEGIN;

DO $$
DECLARE
  v_active_cycle BIGINT;
  v_active_count INTEGER;
  v_deactivated  INTEGER;
  v_kept         INTEGER;
BEGIN
  -- Resolve the single active cycle (fails loudly if none / several exist)
  SELECT COUNT(*) INTO v_active_count FROM public.cycles WHERE is_active;
  IF v_active_count = 0 THEN
    RAISE EXCEPTION 'No active cycle found — refusing to deactivate markups.';
  END IF;
  IF v_active_count > 1 THEN
    RAISE EXCEPTION '% active cycles found — resolve cycles.is_active first.', v_active_count;
  END IF;
  SELECT id INTO v_active_cycle FROM public.cycles WHERE is_active;

  UPDATE public.branch_item_markups
     SET active = false,
         updated_at = now()
   WHERE active = true
     AND cycle_id <> v_active_cycle;

  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  SELECT COUNT(*) INTO v_kept
    FROM public.branch_item_markups
   WHERE active = true
     AND cycle_id = v_active_cycle;

  RAISE NOTICE 'Deactivated % leftover markup row(s) from retired cycles.', v_deactivated;
  RAISE NOTICE 'Active cycle (%): % markup row(s) remain active.', v_active_cycle, v_kept;
END $$;

COMMIT;
