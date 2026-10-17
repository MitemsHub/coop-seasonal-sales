# Retired-vs-Active Item Twins — Audit Report

**Last updated:** 2026-10-17 (after the R1 split purge and both history remaps) · **Source:** read-only query on the production DB ([scripts/audit-retired-twins.mjs](scripts/audit-retired-twins.mjs), run with `node scripts/audit-retired-twins.mjs`)
**Current state: 214 active / 4 retired items. Only ONE twin pair remains (Auntie B).**

## What happened today (chronological)

### 1. R1 split purge
Of the R1 list, the FK check (`order_lines_item_id_fkey`, proven via a rolled-back dry-run DELETE) showed:
- **#150 Viva Plus Gold 180G, #151 Mai Kwabo Macaroni, #166 Gino Tin Tomatoes 800G** — 0 order references → **hard-deleted** with their 3 `branch_item_prices` rows (one committed transaction).
- **#32 Cap Rice (`RICECAP25KG`, 2 order lines) and #219 Gino Tomatoes Sachet (`TINTOMATOESSACHET`, 47 order lines)** — order-history-held → left retired pending remap.

### 2. History remap + purge of #32 and #219 (49 order lines)
All 49 lines (cycle #1 "2025 Q3 Distribution", Nov 4–24 2025) were remapped to the active twins — `item_id` **and** the NOT-NULL `branch_item_price_id` together, per-branch/cycle price rows matched or created at identical prices. Dry-run holding all invariants (order count 1,250, total ₦337,394,502, line count 6,872, line sum ₦303,497,775, 0 orphans) before a second identical run committed. Both rows purged after.

### 3. History remap + purge of #59 (RETIRED-GINOTINTOMATOESSACHET) and #207 (RICECAPRICE25KG)
Same dry-run-then-commit flow: **210 order lines moved** (198 on #59 across 12 price rows, branches 2/5/7/12/21/23/26/30/31/35/37/39; 12 on #207 branch 38), all in cycle #1. Invariants identical before/after. Both rows purged. (First dry-run exposed a bogus 569-orphan reading caused by a LEFT JOIN overwriting in the purge transaction — corrected to a `NOT EXISTS` check, which reported 0.)

## Remaining twins (1)

| Verdict | Retired item | Retired ID | SKU | Order lines | Active twin | Twin ID | Twin SKU |
|---|---|---|---|---|---|---|---|
| 🔴 Do NOT purge — order history held | Auntie B Spaghetti | **#62** | `SPAGHETTIAB` | **3** (Nov 6–14 2025) | Auntie B Spaghetti | #89 | `SPAGHETTIAUTIEB` |

The `node scripts/audit-retired-twins.mjs` "ORDER-HELD RETIRED ITEMS" section now also flags two retired rows that duplicate nothing but are still unreachable for purge because they hold order history (remap them the same way if you want them gone):
- **#128 Indomietable Noodles** `INDOMIETABLESNOODLES` — **100 order lines** (no active twin of that name exists; choose the correct live item before remap)
- **#38 Gino Tin Tomatoes** `RETIRED-GINOTINTOMATOES` — **27 order lines**

## One anomaly from before, still standing
The retire flow's `RETIRED-` SKU tombstone overwrites the original SKU with no preservation. If restoring #62/#128/#38 could ever matter, add an `original_sku` column first — otherwise the original SKU is unrecoverable once tombstoned.

## Suggested cadence
Run `node scripts/audit-retired-twins.mjs` after each cycle close. Its output now answers both purge prerequisites: duplicates (same normalized name / shared image URL) **and** order-history entanglement — the two things that together decide whether a retired row is deletable or needs a remap first.