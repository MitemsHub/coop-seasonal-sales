-- Admin-managed pick lists for Items Import (category + unit fields).
-- The API also creates this table on demand (lazy DDL, same pattern as
-- items.source) so the feature works before this file is run by hand —
-- running it just makes the table ready ahead of time.
CREATE TABLE IF NOT EXISTS public.item_taxonomy (
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('category', 'unit')),
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, value)
);
