-- =====================================================================
-- Coop Exhibition — member confirmation of receipt
--
-- The pipeline used to end at Delivered, which only said "the vendor/admin
-- handed the goods over". The member had no way to say "yes, I received them",
-- so nothing closed the transaction from their side.
--
-- New terminal state:
--   Delivered  — goods handed over at the stand (vendor or admin)
--   Confirmed  — the member confirmed receipt; this finalises the order
--
-- Cancelled / Pending / Approved are unchanged.
-- =====================================================================

-- The original column-level CHECK is named <table>_<column>_check by Postgres.
ALTER TABLE exhibition_orders DROP CONSTRAINT IF EXISTS exhibition_orders_status_check;

ALTER TABLE exhibition_orders
  ADD CONSTRAINT exhibition_orders_status_check
  CHECK (status IN ('Pending', 'Approved', 'Delivered', 'Confirmed', 'Cancelled'));

-- When the member acknowledged receipt (NULL until they do).
ALTER TABLE exhibition_orders
  ADD COLUMN IF NOT EXISTS member_confirmed_at TIMESTAMPTZ NULL;

-- Who confirmed, for the audit trail (member id snapshot at confirmation time).
ALTER TABLE exhibition_orders
  ADD COLUMN IF NOT EXISTS member_confirmed_by TEXT NOT NULL DEFAULT '';

-- Unconfirmed handovers older than this are the ones a rep/admin chases.
CREATE INDEX IF NOT EXISTS exhibition_orders_awaiting_confirmation_idx
  ON exhibition_orders (delivered_at)
  WHERE status = 'Delivered';

-- ── Verification (run after applying) ────────────────────────────────
--   SELECT status, COUNT(*) FROM exhibition_orders GROUP BY status;
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint WHERE conname = 'exhibition_orders_status_check';
