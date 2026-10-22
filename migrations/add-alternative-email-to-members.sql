-- Migration: alternative_email on members
-- Purpose: allow an OPTIONAL secondary/alternative email on the members upload
-- template so the signup-invite (OTP) flow can reach a member at two
-- addresses when that member has more than one email. It is never required —
-- leaving it blank keeps the single-email behavior exactly as today.
--
-- Notes:
--  • Additive only: no existing column changes, no backfill needed.
--  • The import API writes it only when the sheet has a value, and the
--    auth-status list/send flow reads it (see alternative_email readers).
--  • Mirrors the validation the app already applies to `email` clientside.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS alternative_email TEXT
  CONSTRAINT members_alternative_email_shape CHECK (
    alternative_email IS NULL
    OR alternative_email = ''
    OR alternative_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  );

COMMENT ON COLUMN public.members.alternative_email IS
  'Optional secondary email for the member; OTP invites are also sent here when present. Blank = not used.';
