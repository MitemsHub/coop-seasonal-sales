-- Member notifications inbox
-- A persistent record of order status events (posted, delivered, approved,
-- cancelled, restored, ...) so members can review them on My Coop long after
-- the transient toast has gone. Written by the member-side status watchers.
--
-- dedupe_key makes the watcher idempotent: the same transition observed on a
-- poll re-run (or from a second tab) simply no-ops instead of duplicating.
--
-- Run with:  psql $DATABASE_URL -f migrations/add-member-notifications.sql
-- After applying, reload the PostgREST schema cache so the new table is
-- immediately visible to the API (a fresh table returns 404 until reloaded):
--   psql $DATABASE_URL -c "NOTIFY pgrst, 'reload schema';"
CREATE TABLE IF NOT EXISTS member_notifications (
  id BIGSERIAL PRIMARY KEY,
  member_id TEXT NOT NULL,
  module TEXT NOT NULL CHECK (module IN ('food', 'exhibition')),
  event TEXT NOT NULL,
  order_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL UNIQUE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS member_notifications_member_idx
  ON member_notifications(member_id, created_at DESC);
