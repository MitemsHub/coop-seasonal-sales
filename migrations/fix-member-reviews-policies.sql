-- Fix: Update existing member_reviews to match no-moderation design
-- Run this in Supabase SQL Editor

-- 1. Drop old policies
DROP POLICY IF EXISTS "Public can read approved reviews" ON member_reviews;
DROP POLICY IF EXISTS "Members can insert own reviews" ON member_reviews;
DROP POLICY IF EXISTS "Admin can update reviews" ON member_reviews;

-- 2. Create new policies (no moderation)
CREATE POLICY "Public can read reviews"
  ON member_reviews FOR SELECT
  USING (TRUE);

CREATE POLICY "Members can insert own reviews"
  ON member_reviews FOR INSERT
  WITH CHECK (auth.uid()::text = member_id OR member_id IS NOT NULL);

-- 3. Update column default for new inserts
ALTER TABLE member_reviews ALTER COLUMN approved SET DEFAULT TRUE;

-- 4. Fix index (drop old, create new)
DROP INDEX IF EXISTS idx_member_reviews_approved;
CREATE INDEX IF NOT EXISTS idx_member_reviews_created ON member_reviews(created_at DESC);
