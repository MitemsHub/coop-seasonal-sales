-- Shared staff action audit trail — the "food pattern" used by the food
-- module (post/deliver/rollback) and now the ram module (approve/cancel/
-- restore/deliver). Production Supabase already has this table; this
-- migration makes local/dev environments reproducible.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  order_id TEXT,
  cycle_id BIGINT,
  delivery_branch_id BIGINT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_order_id_action ON audit_log(order_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
