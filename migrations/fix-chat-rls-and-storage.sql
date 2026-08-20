-- Fix chat_messages: drop RLS (service role bypasses it, but empty policies
-- can block queries in some Supabase configurations)
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;

-- Create the chat-attachments storage bucket (public, so images render inline)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated and service_role to upload to chat-attachments
CREATE POLICY "chat_attachments_insert_auth"
  ON storage.objects
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (bucket_id = 'chat-attachments');

-- Allow public read access to chat-attachments
CREATE POLICY "chat_attachments_select_public"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'chat-attachments');
