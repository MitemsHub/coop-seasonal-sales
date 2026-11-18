-- Global uniqueness for exhibition vendor passcodes.
--
-- The stored passcode is a salted scrypt hash, so it cannot be searched or
-- indexed by passcode. This keyed HMAC fingerprint is deterministic across
-- venues and is safe to index; it is not a replacement for the scrypt hash.
--
-- Existing salted hashes cannot be converted without their plaintext. Their
-- rows keep a NULL lookup until the vendor next signs in or an admin resets
-- their passcode. Existing word-based passcodes are outside the six-character
-- format, so they cannot collide with newly generated six-character codes.
ALTER TABLE exhibition_vendors
  ADD COLUMN IF NOT EXISTS passcode_lookup TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS exhibition_vendors_passcode_lookup_key
  ON exhibition_vendors (passcode_lookup)
  WHERE passcode_lookup IS NOT NULL;

COMMENT ON COLUMN exhibition_vendors.passcode_lookup IS
  'Keyed HMAC-SHA256 of the passcode, used only for global uniqueness checks.';
