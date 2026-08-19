-- Move Coop Exhibition audit events onto the shared audit_log table so all
-- three modules (food / ram / exhibition) share one trail. Future events are
-- written to audit_log (module='exhibition') by lib/exhibitionAudit.js; this
-- migration backfills any historical rows from the old table, then drops it.
--
-- Idempotent: safe to re-run after the old table is gone.
-- Run with:  psql $DATABASE_URL -f migrations/move-exhibition-audit-to-shared.sql
-- After applying, reload the PostgREST schema cache so the dropped table is
-- immediately hidden from the API:  NOTIFY pgrst, 'reload schema';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'exhibition_order_audit'
  ) THEN
    INSERT INTO audit_log (module, order_id, actor, action, detail, created_at)
    SELECT
      'exhibition',
      order_id::text,
      actor_label,
      action,
      jsonb_strip_nulls(jsonb_build_object(
        'actor_type', actor_type,
        'note', NULLIF(note, '')
      )),
      created_at
    FROM exhibition_order_audit;

    DROP TABLE exhibition_order_audit CASCADE;
  END IF;
END $$;
