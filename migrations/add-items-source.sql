-- Migration: add items.source so Items Import can separate General vs Outsourced items
--
-- 'general'    = added once by the admin (General Items section), priced in every branch
-- 'outsourced' = refined from a rep's Items Survey draft (Outsourced Items section)
--
-- The API (app/api/admin/items/route.js) also creates this column lazily on
-- first use, so running this file is a no-op if the column already exists.
-- Run in the Supabase SQL editor.

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'general';

COMMENT ON COLUMN public.items.source IS
  'Item origin for Items Import: general (admin, all branches) | outsourced (refined from survey)';

CREATE INDEX IF NOT EXISTS idx_items_source ON public.items(source);
