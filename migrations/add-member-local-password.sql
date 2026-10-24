-- add-member-local-password.sql
-- PASSWORD-ONLY SIGN-IN FOR PENSIONERS (member IDs starting with "P").
-- 99% of pensioners have no email address, so the standard
-- OTP-via-email signup flow can never onboard them. Instead, an admin
-- sets a portal password directly on the member record; the member then
-- signs in with just their Staff ID + password (no email involved).
--
-- Additive and safe:
--   password_hash    — scrypt hash ("$scrypt$N$r$p$salt$hash", lib/localPassword.js);
--                      NULL means no local password set yet.
--   password_set_at  — when the admin (re)set it, for audit.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_set_at timestamptz;
