-- Allow ram status events in the member notifications inbox.
-- The table was created with a CHECK limiting module to food + exhibition;
-- the ram status watcher now records approve/cancel/restore/deliver events
-- into the same inbox, so widen the constraint (replacing it in place keeps
-- existing rows valid).
--
-- Run with:  psql $DATABASE_URL -f migrations/add-ram-member-notifications.sql
-- After applying, reload the PostgREST schema cache so the new constraint is
-- immediately visible to the API:  NOTIFY pgrst, 'reload schema';
ALTER TABLE member_notifications DROP CONSTRAINT IF EXISTS member_notifications_module_check;
ALTER TABLE member_notifications
  ADD CONSTRAINT member_notifications_module_check
  CHECK (module IN ('food', 'exhibition', 'ram'));
