-- Vendor contact email for sending exhibition login details, plus the time
-- those details were last emailed from the admin page. Safe to re-run.
ALTER TABLE exhibition_vendors
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS login_sent_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS exhibition_vendors_email_idx
  ON exhibition_vendors (lower(email))
  WHERE email <> '';
