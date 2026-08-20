-- Add missing attachment columns to chat_messages
-- (table was created before these columns were added to the migration)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
