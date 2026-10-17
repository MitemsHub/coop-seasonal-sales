# Retired-vs-Active Item Twins — Audit Report

**Date:** 2026-10-17 · **Source:** read-only query on the production DB ([scripts/audit-retired-twins.mjs](scripts/audit-retired-twins.mjs), run with `node scripts/audit-retired-twins.mjs`)
**Scale:** 214 active / 11 retired items. Of the 11 retired rows, **7 duplicate a still-active item** (2 overlap in both checks).

## Why these matter
- On a shared image URL they currently compete with the active row's entry for the same bank photo — the exact cause of last week's "Gino Tomatoes Sachet wouldn't show in the refined-image picker" bug (fixed in code, but the data is still there).
- In the Image Bank's **Deleted items** panel they look like real deletable/restorable items, inviting accidental restores that create new twins.
- They hold their own `branch_item_prices` rows (1–14 each) that keep surfacing in cycle / report queries that don't filter `is_active`.

## 7. Retired items that duplicate an active item

| # | Retired item | Retired ID | SKU | Priced branches | Active twin | Twin ID | Twin SKU |
|---|---|---|---|---|---|---|---|
| 1 | Auntie B Spaghetti | #62 | `SPAGHETTIAB` | 2 | Auntie B Spaghetti | #89 | `SPAGHETTIAUTIEB` |
| 2 | Cap Rice 25Kg (RICECAP25KG) | #32 | `RICECAP25KG` | 1 | Cap Rice 25Kg | #134 | `CAPRICERICE25KG` |
| 2b | Cap Rice 25Kg (RICECAPRICE25KG) | #207 | `RICECAPRICE25KG` | 1 | Cap Rice 25Kg | #134 | `CAPRICERICE25KG` |
| 3 | Gino Tin Tomatoes 800G | #166 | `GINOTINTOMATOES800G` | 1 | Gino Tin Tomatoes 800G | #13 | `TINTOMATOES800G` |
| 4 | Gino Tomatoes Sachet (tombstoned) | #59 | `RETIRED-GINOTINTOMATOESSACHET` | **14** | Gino Tomatoes Sachet | #14 | `GINOTOMATOESSACHET` |
| 4b | Gino Tomatoes Sachet (TINTOM…) | #219 | `TINTOMATOESSACHET` | 1 | Gino Tomatoes Sachet | #14 | `GINOTOMATOESSACHET` |
| 5 | Mai Kwabo Macaroni | #151 | `MACARONIMAIKWABO` | 1 | Mai Kwabo Macaroni | #10 | `MACARONIMK` |
| 6 | Viva Plus Gold 180G | #150 | `VIVA180G` | 1 | Viva Plus Gold 180G | #145 | `VIVAPLUS180G` |

Note: retired **#219 is a special case — it's the ghost twin of #14's own history.** Its SKU (`TINTOMATOESSACHET`) collides with an image filename the ACTIVE #14 still uses (`items/TINTOMATOESSACHET.png`). It has only 1 priced branch, so it's the safest twin to drop outright (see recommendation R1 for the image side, which stays untouched either way).

## One anomaly noticed on #59 (worth a look even outside the twin question)
The retired #59 has a **tombstoned SKU dated before the retirement was standardized** — its SKU is `RETIRED-GINOTINTOMATOESSACHET` but the retirement logic expects the tombstone to also carry a prefix of the ORIGINAL sku. Right now the items table has NO visible trace of the ORIGINAL SKU (`GINOTINTOMATOESSACHET`) anywhere — it was overwritten entirely by the tombstone. If you ever want to restore #59 from Deleted items, it will restore under the tombstoned SKU unless you also carry the original SKU in a separate column/field before the tombstone run.

## Recommendations (in order of safety)

### R1 — Safe to hard-delete now (no pricing history or only trivial 1-branch history)
- `#219 Gino Tomatoes Sachet` — 1 branch. Its `TINTOMATOESSACHET` SKU also collides with the literal filename the ACTIVE #14 uses for its image; removing the item does NOT remove the image file (the bank image lives at items/TINTOMATOESSACHET.png and stays).
- `#166 Gino Tin Tomatoes 800G` (1 branch) — benefits immediately: the active twin #13 will stop having a "RETIRED-first" dedupe competitor on a *different* URL (it doesn't share one — this one is purely a name twin).
- `#151 Mai Kwabo Macaroni` (1 branch)
- `#150 Viva Plus Gold 180G` (1 branch)
- `#32 Cap Rice 25Kg (RICECAP25KG)` (1 branch) — this also removes the case-insensitive "RICECAPRICE25KG" collision the active #134 sits under.

### R2 — Soft-retire then purge later (keep the rows for 1–2 cycles, they hold real pricing spread)
- `#207 Cap Rice 25Kg (RICECAPRICE25KG)` (1 branch) — could also go into R1; it's only expensive by SKU-debt, not by shop impact.
- `#62 Auntie B Spaghetti` (2 branches)
- `#166 also fits here if R1 feels aggressive`

### R3 — Do NOT purge yet, even though it's a "twin"
- `#59 Gino Tomatoes Sachet` — **14 branches** priced with it. This isn't cruft — it was until recently the item your branch shops were actually running on. Purging it now would silently remove price rows for 14 branch cycles, which would **change historical report data**. If the goal is to stop it competing with active #14 for anything, the code fix already does that. Leave it retired but untouched, or (longer term) migrate its price rows to point at #14 before deleting.

### R4 — Keep only ONE of the two DEDUPE-relevant retired rows under "Gino Tomatoes Sachet"
- `#219` and `#59` are both retired with the same normalized name and the same active twin #14. Keeping both means the Deleted panel shows 2 confusing rows for the same product. R1 + R3 together resolve that: delete #219, keep #59 (history-carrying).

## What to run if you want to act on R1 (draft; verify before executing)
```sql
-- hard-delete only from R1's list. This will fail with FK errors if any
-- order/inventory/report row still references these items; fix that before running.
DELETE FROM public.items WHERE item_id IN (219, 166, 151, 150, 32);
```
Then re-run `node scripts/audit-retired-twins.mjs` to confirm only R3 rows remain.

## One suggested follow-up
The current `is_active` snapshot means "retired" rows sit in `items` forever unless manually cleaned. Once you decide R1's deletions are OK, consider a periodic check (same script, run it after each cycle close) so new twins are caught while their price footprint is still tiny.