-- migrations/fix-audit-log-created-at.sql
-- The audit_log table in production is missing the created_at column
-- that the original migration defined. This adds it if absent.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
