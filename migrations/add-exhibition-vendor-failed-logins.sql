-- Failed sign-in attempts per vendor, recorded by app/api/vendor/session.
-- A wrong passcode on a known vendor code increments failed_login_count and
-- stamps last_failed_login_at so admins can see who could not get in.
-- Safe to re-run.
ALTER TABLE exhibition_vendors
  ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN exhibition_vendors.failed_login_count IS
  'Number of wrong-passcode sign-in attempts recorded for this vendor.';

COMMENT ON COLUMN exhibition_vendors.last_failed_login_at IS
  'Timestamp of the most recent failed sign-in attempt, NULL if none recorded.';
