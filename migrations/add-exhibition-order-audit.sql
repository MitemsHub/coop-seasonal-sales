-- Exhibition order audit trail
-- Records who approved / cancelled / restored / delivered each exhibition
-- order and when. One row per event, so an order's full history survives
-- multiple transitions (e.g. Cancelled → Restored → Approved → Cancelled).
--
-- Run with:  psql $DATABASE_URL -f migrations/add-exhibition-order-audit.sql
-- After applying, reload the PostgREST schema cache so the new table is
-- immediately visible to the API (a fresh table returns 404 until reloaded):
--   psql $DATABASE_URL -c "NOTIFY pgrst, 'reload schema';"
CREATE TABLE IF NOT EXISTS exhibition_order_audit (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES exhibition_orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('Approved', 'Cancelled', 'Restored', 'Delivered')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('rep', 'admin', 'vendor', 'system')),
  actor_label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS exhibition_order_audit_order_idx ON exhibition_order_audit(order_id, created_at);
CREATE INDEX IF NOT EXISTS exhibition_order_audit_created_idx ON exhibition_order_audit(created_at);
