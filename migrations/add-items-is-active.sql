-- Migration: item removal (Cancel) — items.is_active + food_survey_entries.cancelled
--
-- The admin's Cancel action (DELETE /api/admin/items?item_id=) does NOT delete
-- a row. It flips items.is_active to false (shop, pickers and Image Bank's
-- active cards all read the flag; order history stays intact; the SKU is
-- tombstoned to RETIRED-<code> so the code frees up for the next item), and
-- stamps cancelled=true on every survey entry that resolved to the item —
-- so the Survey keeps the entry (the rep's submission is history) but shows
-- a Cancelled badge. Restore undoes both. The API creates these columns
-- lazily on first use (same pattern as items.source), so running this file
-- is a no-op if they already exist.
--
-- Run in the Supabase SQL editor.

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.food_survey_entries ADD COLUMN IF NOT EXISTS cancelled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.items.is_active IS
  'false = cancelled by the admin (hidden everywhere, restorable). Cancel also re-homes the SKU behind a RETIRED- tombstone so the code can never collide or resurrect.';

COMMENT ON COLUMN public.food_survey_entries.cancelled IS
  'true = the admin cancelled the saved product for this entry (Survey shows a Cancelled badge; Items Import treats the draft as not worked on).';

CREATE INDEX IF NOT EXISTS idx_items_is_active ON public.items(is_active);
