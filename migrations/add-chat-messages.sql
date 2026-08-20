-- Chat Messages: live chat between members and admins
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('member', 'admin')),
  sender_id   TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  attachment_url  TEXT,
  attachment_type TEXT CHECK (attachment_type IN ('image', 'file')),
  attachment_name TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fetching a conversation (member's messages + admin replies)
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON chat_messages (sender_id, created_at DESC);

-- Index for admin: unread messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
  ON chat_messages (read_at) WHERE read_at IS NULL;

-- Row-level security (optional, can be enabled later)
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
