-- When a vendor last signed in successfully (set by app/api/vendor/session).
-- Safe to re-run.
ALTER TABLE exhibition_vendors
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN exhibition_vendors.last_login_at IS
  'Timestamp of the vendor''s last successful sign-in. NULL means never signed in.';

CREATE INDEX IF NOT EXISTS exhibition_vendors_last_login_idx
  ON exhibition_vendors (last_login_at);
