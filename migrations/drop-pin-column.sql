-- Drop PIN-based auth from members table
-- This migration removes the legacy PIN column that was used before
-- Supabase Auth was adopted for member authentication.

-- Drop the index on pin first
DROP INDEX IF EXISTS idx_members_pin;

-- Drop the pin column
ALTER TABLE members DROP COLUMN IF EXISTS pin;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'members' AND column_name = 'pin';
