// lib/itemOverrides.js
// Per-branch catalog fields for OUTSOURCED items.
//
// The items row is ONE shared catalog entry (items.name/category/unit/
// image_url) — that was fine for General items, but an admin refining a
// branch's outsourced card rewrote what every other branch displayed (the
// "Indomitables Noodles category edited in Coop Secretariat appeared on
// Abuja/Head Office cards" report). item_branch_overrides gives each branch
// its own copy of the display fields; the shared row remains the fallback
// for branches without an override.
//
//   • loadOverrides(itemIds)            → Map `${branch_id}::${item_id}` → fields
//   • coalesceItem(row, override)       → merged display row ("" clears)
//   • snapshotItemForOtherBranches(...) → freeze other branches at the current
//                                         shared values BEFORE an edit
//   • writeOverride({branchId,itemId,…})→ upsert one branch's fields
//                                         (null = keep the stored value)
//
// Writes go through queryDirect with lazy-DDL so a project that hasn't run
// the migration yet still works (same pattern as ensureSourceColumn).
import { queryDirect } from './directDb'

const ensureOnce = { ran: false, ok: false }
export async function ensureOverrideTable() {
  if (ensureOnce.ran) return ensureOnce.ok
  ensureOnce.ran = true
  try {
    await queryDirect(`
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
      )`)
    try {
      await queryDirect(`CREATE INDEX IF NOT EXISTS idx_item_branch_overrides_item ON public.item_branch_overrides(item_id)`)
    } catch {}
    ensureOnce.ok = true
  } catch (e) {
    console.warn('item_branch_overrides ensure skipped:', e?.message || e)
    ensureOnce.ok = false
  }
  return ensureOnce.ok
}

// Map for the read paths. Missing table / no rows → empty map (shared copy).
export async function loadOverrides(itemIds) {
  const ids = [...new Set((itemIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  if (!ids.length) return new Map()
  try {
    const res = await queryDirect(
      `SELECT branch_id, item_id, name, category, unit, image_url
         FROM public.item_branch_overrides
        WHERE item_id = ANY($1::bigint[])`,
      [ids]
    )
    const map = new Map()
    for (const r of res.rows || []) {
      map.set(`${r.branch_id}::${r.item_id}`, {
        name: r.name,
        category: r.category,
        unit: r.unit,
        image_url: r.image_url,
      })
    }
    return map
  } catch (e) {
    // Table not created yet (or DB hiccup) → behave as if no overrides exist.
    return new Map()
  }
}

// Merge one branch's fields into a row. An empty-string field is a
// deliberate clerical clear (the admin blanked the category), while NULL
// in the override means "revert to the shared copy" — so coalesce on null
// but take '' verbatim.
export function coalesceItem(row, override) {
  if (!override || !row) return row
  return {
    ...row,
    name: override.name != null && override.name !== '' ? override.name : row.name,
    category: override.category != null ? override.category : row.category,
    unit: override.unit != null ? override.unit : row.unit,
    image_url: override.image_url != null ? override.image_url : row.image_url,
  }
}

// Freeze every OTHER branch that prices this outsourced item at the CURRENT
// shared copy, so the branch being edited is the only one that moves.
// conflict → keep (an existing branch-specific copy always wins).
export async function snapshotItemForOtherBranches(itemId, excludeBranchId, base) {
  await ensureOverrideTable()
  try {
    await queryDirect(
      `INSERT INTO public.item_branch_overrides (branch_id, item_id, name, category, unit, image_url)
       SELECT p.branch_id, $1::bigint, $2, $3, $4, $5
         FROM public.branch_item_prices p
        WHERE p.item_id = $1::bigint
          AND ($6::bigint IS NULL OR p.branch_id <> $6::bigint)
          AND ($2 IS NOT NULL OR $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL)
       ON CONFLICT (branch_id, item_id) DO NOTHING`,
      [
        Number(itemId),
        base?.name ?? null,
        base?.category ?? null,
        base?.unit ?? null,
        base?.image_url ?? null,
        excludeBranchId ? Number(excludeBranchId) : null,
      ].map((v) => (v === undefined ? null : v))
    )
    return true
  } catch (e) {
    console.warn('item_branch_overrides snapshot skipped:', e?.message || e)
    return false
  }
}

// Upsert ONE branch's fields. A null / omitted field keeps whatever the
// branch currently has (patch semantics for fields the caller didn't touch).
export async function writeOverride({ branchId, itemId, name, category, unit, image_url }) {
  await ensureOverrideTable()
  try {
    await queryDirect(
      `INSERT INTO public.item_branch_overrides (branch_id, item_id, name, category, unit, image_url)
       VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6)
       ON CONFLICT (branch_id, item_id) DO UPDATE SET
         name = CASE WHEN $3 IS NULL THEN item_branch_overrides.name ELSE EXCLUDED.name END,
         category = CASE WHEN $4 IS NULL THEN item_branch_overrides.category ELSE EXCLUDED.category END,
         unit = CASE WHEN $5 IS NULL THEN item_branch_overrides.unit ELSE EXCLUDED.unit END,
         image_url = CASE WHEN $6 IS NULL THEN item_branch_overrides.image_url ELSE EXCLUDED.image_url END,
         updated_at = now()`,
      [
        Number(branchId),
        Number(itemId),
        name ?? null,
        category ?? null,
        unit ?? null,
        image_url ?? null,
      ]
    )
    return true
  } catch (e) {
    console.warn('item_branch_overrides write skipped:', e?.message || e)
    return false
  }
}
