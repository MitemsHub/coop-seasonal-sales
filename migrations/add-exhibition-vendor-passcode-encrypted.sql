-- Recoverable (encrypted) copy of each exhibition vendor passcode.
--
-- `passcode` remains a salted scrypt hash and is the only value sign-in checks.
-- This column holds the same passcode sealed with AES-256-GCM under a key
-- derived from APP_SECRET, so an admin can read the passcode back on the
-- vendors page without weakening the hash.
--
-- Rows that existed before this migration keep NULL here: their plaintext was
-- destroyed by hashing, so admins see "issue a new passcode" for them until the
-- next reset (or their next successful sign-in, for legacy plaintext rows).
ALTER TABLE exhibition_vendors
  ADD COLUMN IF NOT EXISTS passcode_encrypted TEXT NULL;

COMMENT ON COLUMN exhibition_vendors.passcode_encrypted IS
  'AES-256-GCM sealed copy of the vendor passcode (key derived from APP_SECRET), for admin display only.';
