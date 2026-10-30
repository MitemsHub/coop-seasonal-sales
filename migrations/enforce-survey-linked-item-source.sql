-- =============================================================================
-- enforce-survey-linked-item-source.sql
--
-- WHY: items.source is what splits "General Items" from "Outsourced" on the
-- Items Import page, and General promises "added once — priced in EVERY
-- branch". Nothing enforced that promise. Two ways a branch-scoped rep
-- product ended up wearing the General badge:
--
--   * Fresh Red Oil 5L (#360) — a repair script rebuilt the row during the
--     2026-10-30 identity split and the new row inherited the column default
--     'general';
--   * So Klin 22g (#463) — fix-soklin22g-twin.mjs moved survey entry 440
--     ("Klin 22g", Uyo) and Uyo's single price row onto a plain bank row
--     whose source was still 'general'.
--
-- Both share one signature: a LIVE rep survey entry points at the item while
-- the item is NOT priced in every branch. Genuine General products (#5
-- Golden Penny Spaghetti, #16 Golden Morn 45G, #18 Milo 400G — all also
-- linked by surveys) are priced in all 39 branches and are exempt.
--
-- THE GUARD: when a survey draft is linked to an item, flip general ->
-- outsourced UNLESS that item has ever been priced in every branch of some
-- cycle (i.e. it really is a catalog product). One direction only: nothing
-- here ever demotes an outsourced item to general, so the shop can never
-- "gain" a branch-scoped product in the General list again.
--
-- The app's own save path already refuses to touch the other section (see
-- the foreignWorld guard in app/api/admin/items/route.js); this covers
-- scripts, manual SQL and any future writer.
--
-- Apply: node scripts/apply-migration.mjs migrations/enforce-survey-linked-item-source.sql
--        (or paste into the SQL editor). Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_survey_linked_item_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_source   varchar;
  v_priced   int := 0;
  v_total    int := 0;
BEGIN
  IF NEW.saved_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.source INTO v_source
    FROM public.items i
   WHERE i.item_id = NEW.saved_item_id;

  -- Already Outsourced (the normal case: the app pins drafts only for
  -- outsourced saves), missing row, or no source column: nothing to correct.
  IF v_source IS DISTINCT FROM 'general' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::int INTO v_total FROM public.branches;
  IF v_total = 0 THEN
    RETURN NEW;
  END IF;

  -- "Ever priced in every branch in any cycle" = a real catalog (General)
  -- product. Checked across ALL cycles so linking a draft in a brand-new
  -- cycle — before that cycle's general pricing import runs — can never
  -- misclassify last cycle's catalog item.
  SELECT COALESCE(MAX(cnt), 0) INTO v_priced
    FROM (
      SELECT COUNT(DISTINCT branch_id)::int AS cnt
        FROM public.branch_item_prices
       WHERE item_id = NEW.saved_item_id
       GROUP BY cycle_id
    ) per_cycle;

  IF v_priced < v_total THEN
    UPDATE public.items
       SET source = 'outsourced'
     WHERE item_id = NEW.saved_item_id
       AND COALESCE(source, 'general') = 'general';
    RAISE NOTICE
      'item % linked to a survey draft and priced in % of % branches max -> source=outsourced',
      NEW.saved_item_id, v_priced, v_total;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_survey_linked_item_source ON public.food_survey_entries;

CREATE TRIGGER trg_enforce_survey_linked_item_source
  BEFORE INSERT OR UPDATE OF saved_item_id
  ON public.food_survey_entries
  FOR EACH ROW
  WHEN (NEW.saved_item_id IS NOT NULL)
  EXECUTE FUNCTION public.enforce_survey_linked_item_source();

COMMENT ON FUNCTION public.enforce_survey_linked_item_source() IS
  'Flips a general-flagged item to outsourced when a rep survey draft is linked to it and it is not priced in every branch in any cycle. General = catalog product priced everywhere; a branch-scoped rep product must never sit in the General list.';
