-- Add Supabase Auth user ID to members table
-- This links each member record to their Supabase Auth account,
-- enabling email+password login and OTP verification via Supabase Auth.

-- Add the auth_user_id column (UUID referencing auth.users)
ALTER TABLE members
ADD COLUMN IF NOT EXISTS auth_user_id UUID NULL;

-- Add an index for fast lookups by auth user ID
CREATE INDEX IF NOT EXISTS idx_members_auth_user_id
ON members(auth_user_id)
WHERE auth_user_id IS NOT NULL;

-- Add a unique constraint so each Supabase Auth user can only be linked to one member
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_auth_user_id_unique
ON members(auth_user_id)
WHERE auth_user_id IS NOT NULL;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'members' AND column_name = 'auth_user_id';
