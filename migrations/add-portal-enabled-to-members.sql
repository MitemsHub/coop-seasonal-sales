-- Migration: portal_enabled on members
--
-- Backdrop: the coop only wants members actually present in the latest
-- official member import to use the member portal (sign-in, eligibility,
-- ordering). The import cannot be reverse-engineered from created_at, and
-- the latest import matched 11,293 pre-existing rows — so we tag membership
-- explicitly.
--
-- Semantics:
--   portal_enabled = TRUE  → member works normally (sign-in, eligibility, ordering)
--   portal_enabled = FALSE → member is invisible to the member portal:
--     /api/members/auth/* treats them as not found, eligibility/order APIs
--     return "Member not found". Admin views still list them for reference.
--     Re-uploading the members workbook re-enables them (import sets TRUE).
--     Admin-added members are created by other flows — those keep the default.
--
-- Default TRUE so applying this migration changes nothing by itself.
-- The one-off cohort script (scripts/apply-member-cohort.mjs) flips it
-- per the supplied member-ID list.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Partial index: disabled members are rare, and every portal lookup filters on them
CREATE INDEX IF NOT EXISTS members_portal_enabled_false_idx
  ON public.members (member_id)
  WHERE portal_enabled = FALSE;

COMMENT ON COLUMN public.members.portal_enabled IS
  'FALSE = excluded from the member portal (sign-in, eligibility, ordering). Set TRUE by the members import for every imported member.';
