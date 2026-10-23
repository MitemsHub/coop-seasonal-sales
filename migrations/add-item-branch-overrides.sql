-- Migration: per-branch catalog fields for OUTSOURCED items.
-- items.name/sku/category/unit/image_url are the shared catalog copy every
-- branch reads. Prices were always per-branch (branch_item_prices), but the
-- display fields were not — an admin refining a branch card rewrote every
-- branch's card (the Indomitables-noodles Category/Unit leak).
--
-- item_branch_overrides stores a branch-owned copy of the display fields for
-- OUTSOURCED items only. General items stay one shared catalog (deliberate).
-- The API also creates this table on demand (lib/itemOverrides.js), so a
-- deployment not yet migrated keeps working.
CREATE TABLE IF NOT EXISTS public.item_branch_overrides (
  id         BIGSERIAL PRIMARY KEY,
  branch_id  BIGINT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  item_id    BIGINT NOT NULL REFERENCES public.items(item_id) ON DELETE CASCADE,
  name       TEXT,
  category   TEXT,
  unit       TEXT,
  image_url  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_item_branch_overrides_item
  ON public.item_branch_overrides(item_id);

-- NULL in a field means "revert this field to the shared catalog copy";
-- an empty string means "the branch deliberately cleared it".
COMMENT ON TABLE public.item_branch_overrides IS
  'Per-branch display fields (name/category/unit/image) for OUTSOURCED items; GENERAL items remain one shared catalog.';
