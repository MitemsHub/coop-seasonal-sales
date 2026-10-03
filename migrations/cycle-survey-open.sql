-- Migration: survey activation control + rep phone number.
-- Run once in the Supabase SQL editor (idempotent — safe to re-run).
--
-- Rules implemented in code:
--   * A cycle's survey is OPEN when survey_open = true AND its end date has
--     not passed (cycles with no dates stay open until the admin closes them
--     — same behaviour as the food distribution cycle).
--   * Only one cycle can have the survey open at a time.
--   * When the admin closes it, or the end date passes, the survey becomes
--     read-only (reps can no longer submit or edit).
--   * The phone number on the survey's "About you" section is stored on
--     food_survey_submissions.phone.

-- ── 1. Per-cycle survey activation ────────────────────────────────────────
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS survey_open BOOLEAN NOT NULL DEFAULT false;

-- A cycle whose end date has passed can never hold the open survey — clear
-- any stale flag (e.g. from an earlier run of this script that used the
-- active-cycle backfill).
UPDATE cycles SET survey_open = false
WHERE ends_at IS NOT NULL AND ends_at + INTERVAL '1 day' <= NOW();

-- Open the survey for exactly one live cycle: prefers the active cycle,
-- falls back to the newest cycle whose end date hasn't passed. (With the
-- current data that picks "2026 Q3 Distribution"; a cycle whose end date
-- already passed is never auto-opened.)
UPDATE cycles SET survey_open = true
WHERE id IN (
  SELECT id FROM cycles
  WHERE (ends_at IS NULL OR ends_at + INTERVAL '1 day' > NOW())
  ORDER BY is_active DESC, id DESC
  LIMIT 1
);

-- ── 2. Rep phone number on each submission ────────────────────────────────
ALTER TABLE food_survey_submissions ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
