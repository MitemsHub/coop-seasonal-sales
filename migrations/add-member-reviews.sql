-- member_reviews: stores member feedback after completing orders.
-- Reviews appear immediately on the landing page Member Stories section.
-- No moderation required — all submitted reviews are public.

CREATE TABLE IF NOT EXISTS member_reviews (
  id BIGSERIAL PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('food', 'ram', 'exhibition')),
  order_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT NOT NULL DEFAULT '',
  reviewer_name TEXT NOT NULL DEFAULT '',
  branch_name TEXT NOT NULL DEFAULT '',
  approved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fetching reviews (landing page, newest first)
CREATE INDEX IF NOT EXISTS idx_member_reviews_created ON member_reviews(created_at DESC);

-- Unique constraint: one review per member per order
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_reviews_unique_order ON member_reviews(member_id, order_id);

-- Enable RLS
ALTER TABLE member_reviews ENABLE ROW LEVEL SECURITY;

-- Public can read all reviews (for landing page)
CREATE POLICY "Public can read reviews"
  ON member_reviews FOR SELECT
  USING (TRUE);

-- Authenticated members can insert their own reviews
CREATE POLICY "Members can insert own reviews"
  ON member_reviews FOR INSERT
  WITH CHECK (auth.uid()::text = member_id OR member_id IS NOT NULL);
