// REPAIR: undo the General×Outsourced cross-link damage reported 2026-10-20.
//
// What went wrong (discovered from live data):
//   • Generic-outsourced drafts (Semovita/Samvita/Samolina/Gino/Custard) were
//     linked to item #3 — Fresh Red Oil 5L — by the price-only recovery and
//     by the admin re-saving through the editor (each save re-points the
//     link entry → item and drops a price row per branch).
//   • The chain progressively renamed item #3 away from its real identity,
//     finally landing on "Fresh Red Oil 5L" / FRESHREDOIL5L-2 — the -2
//     because the admin created a *second* FRESHREDOIL5L row when re-saving.
//   • FRESHREDOIL5L-2's get-item-by-SKU lookup found NO existing row (its
//     real one was tombstoned RETIRED-FRESHREDOIL5L-…), so 39 extra branches
//     were written GM price rows.
//   • Entry #504 (Enugu "Fresh Red oil 5 litres", ₦14,500) was correctly
//     linked to #3 all along, but the *edit form was contaminated* by
//    .getEnd: branches OTHER than Enugu price rows showed the collapse- to-
//     minimum value as in_shop price which is NOT what the shop shows.
//
// Fix plan (idempotent, copious output, transaction-guarded):
//  A. Restore each mis-linked entries' link to its REAL outsourced item:
//     entry 808 → Flour Semovita (not found by name, so → unlinked)
//     entry 623 → item 309 (Goals SemoFlo Samolina product)
//  B. Restore item #3's identity to its original chain (name/SKU wrapped):
//     back to 'Golden Penny Semo 1Kg' → 'Golden Penny Semovita 1kg' — see
//     the /v1/semovita1kg//object/public/items/SEMOVITA1KG.png bank image.
//  C. Repoint prices to their correct products:
//     • item #3's 39 non-Enugu price rows are DELISTED (deleted) — those
//       branches never actually sell Fresh Red Oil 5L;
//     • #3's cycle-1 rows stay (that was the historical record);
//     • FRESHREDOIL5L-2's sku → FRESHREDOIL5L (the true original SKU).
//  D. FRESHREDOIL5L-2 (the duplicate item #3? or is the twin the #3? examine!)
//  E. Clear wrongly-set cancelled flags from the entry-repair pass:
//     entries 509/253/328 got cancelled by the admin through cancelled cards
//     whose real product was RETIRED — but Semovita 1kg is back, so these
//     re-point to what they should be.
//
// Every step prints what it matched so you can read the effects directly.

import 'dotenv/config'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const { default: fs } = await import('node:fs')
      const txt = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run')
if (!process.env.SUPABASE_DB_URL) {
  console.error('No SUPABASE_DB_URL found')
  process.exit(1)
}
console.log(DRY ? 'MODE: DRY-RUN — no writes.\n' : 'MODE: WRITE — changes ARE applied.\n')

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const q = async (sql, params = []) => (await client.query(sql, params)).rows
const run = async (label, sql, params = []) => {
  if (DRY) {
    console.log(`[dry] ${label} — would run: ${sql.slice(0, 110)}${sql.length > 110 ? '…' : ''} ${params.length ? JSON.stringify(params) : ''}`)
    return null
  }
  const res = await client.query(sql, params)
  console.log(`[ok ] ${label} — ${res.rowCount} row(s)`)
  return res
}

// ── Preflight: what the damage looks like ─────────────────────────────
const item3 = (await q(`SELECT item_id, sku, name, source, is_active, image_url FROM items WHERE item_id = 3`))[0]
const item360 = (await q(`SELECT item_id, sku, name, source, is_active, image_url FROM items WHERE item_id = 360`))[0]
console.log('item #3  (outsourced):', JSON.stringify(item3))
console.log('item #360 (general):  ', JSON.stringify(item360))
console.log('')

// ── A. Fix the mis-linked outsourced entries ─────────────────────────
// Every linked entry must point at the product whose name it actually is.
// Gombe "Samolina" ₦14,500 → item 309 (SemoFlo Samolina, the Gombe-priced
// product); Ibadan "Flour Semovita 10kg" — item 4 exists, but 808 declares
// cycle-3 at ₦14,500 which is exactly the #3 price it mis-claimed… the
// honest answer is to UNLINK (name says Semovita-10kg; whether the admin's
// Ibadan save really was #4 is not provable) and leave the draft for the
// admin to re-save authoritatively.
// Item 309 turned out to be "Samvita Garri Flour 1Kg", NOT Samolina — the
// Gombe Samolina entry has no real product either, so every affected entry
// is simply unlinked and handed back to the admin as an honest unsaved card.
const relinks = [
  { entry: 623, to: null, why: 'Gombe Samolina: no real Samolina item exists (309 is Samvita Garri); un-link' },
  { entry: 808, to: null, why: 'Ibadan Flour Semovita 10kg: unprovable, un-link' },
  { entry: 444, to: null, why: 'Uyo Gino Maxi: no Gino-Maxi item exists; un-link' },
  { entry: 153, to: null, why: 'Bauchi Gino Maggi: no item; un-link' },
  // Cancelled entries 509/253/328: their CANCEL flags were the admin's
  // deliberate actions during the twin incidents and STAY. Only the links
  // are corrupt; with the link cleared, a cancelled entry no longer hides
  // any product from any branch's shop and renders as its own Cancelled card.
  { entry: 509, to: null, why: "Abeokuta Samvita: un-link (cancel flag kept — admin's deliberate cancel)" },
  { entry: 253, to: null, why: 'Kaduna Custard (Checkers) 2kg/6: un-link (cancel flag kept)' },
  { entry: 328, to: null, why: 'Akure Semovita 1kg: un-link (cancel flag kept)' },
]
for (const r of relinks) {
  if (r.to == null) {
    await run(`unlink entry ${r.entry}`, `UPDATE public.food_survey_entries SET saved_item_id = NULL WHERE id = $1`, [r.entry])
  } else {
    await run(`relink entry ${r.entry} → item ${r.to}`, `UPDATE public.food_survey_entries SET saved_item_id = $1 WHERE id = $2`, [r.to, r.entry])
  }
  console.log(`        ${r.why}`)
}

// ── B. Restore item #3's identity? NO — item #3 IS Fresh Red Oil 5L by design now.
// What MUST change is the SKU tombstone collision: #3 holds FRESHREDOIL5L-2
// while (the retired) #360 holds the plain FRESHREDOIL5L. Restore #3 to the
// plain SKU; #360 (general, not priced) retires with the tombstone swap.
// ── B. Restore #3 to the plain SKU. Order matters — #360 must vacate
// FRESHREDOIL5L FIRST or the unique items_sku_key rejects the swap.
await run(`item #360 SKU → RETIRED-GENERAL-FRESHREDOIL5L`, `UPDATE public.items SET sku = 'RETIRED-FRESHREDOIL5L-GENERAL' WHERE item_id = 360`)
await run(`item #3 SKU → FRESHREDOIL5L`, `UPDATE public.items SET sku = 'FRESHREDOIL5L' WHERE item_id = 3`)

// ── C. Delete #3's stray price rows — every branch except Enugu (17) in
// cycle 3 never genuinely saved this product (recovery wrote them with the
// draft price). Cycle-1 rows are historical; leave them.
const stray = await q(`
  SELECT p.id, p.branch_id, b.name branch_name, p.price
  FROM branch_item_prices p LEFT JOIN branches b ON b.id = p.branch_id
  WHERE p.item_id = 3 AND p.cycle_id = 3 AND p.branch_id <> 17`)
console.log(`\nStray cycle-3 price rows for #3 (besides Enugu’s ₦14,500): ${stray.length}`)
if (stray.length > 0 && stray.length <= 80) {
  await run(`delete stray price rows`, `DELETE FROM public.branch_item_prices WHERE item_id = 3 AND cycle_id = 3 AND branch_id <> 17`)
  console.log('        (deleted: ' + stray.map((s) => ` ${s.id}@${s.branch_name}=${s.price}`).join(', ') + ')')
} else if (stray.length > 80) {
  console.log('        ABORTING this step — unexpected row count, review first.')
}

// ── D. Cancel flags are the admin's deliberate actions — NOT touched.
// Only the LINKS were corrupt (written by the price-only recovery). The
// cancelled entries 509/253/328 keep their flags; once unlinked they can
// no longer hide #3 from their branches' shops, and they render as honest
// Cancelled cards in the Outsourced list.
console.log('\nCancel flags on entries 509/253/328: kept untouched (admin deliberate).')

// ── E. Verify the end state ──────────────────────────────────────────
console.log('\n── Verification ──')
const v1 = await q(`SELECT id, item_name, price, saved_item_id, cancelled FROM food_survey_entries WHERE saved_item_id = 3 OR id IN (444, 153, 808, 623) ORDER BY id`)
console.log('Links to #3 + repaired entries:')
for (const e of v1) console.log(`  entry #${e.id} [${e.item_name}] -> #${e.saved_item_id ?? '-'} cancelled=${e.cancelled}`)
const v2 = await q(`SELECT item_id, sku FROM items WHERE item_id IN (3, 360)`)
console.log('SKU state:', JSON.stringify(v2))
const v3 = await q(`SELECT branch_id, cycle_id, price FROM branch_item_prices WHERE item_id = 3 ORDER BY cycle_id, branch_id`)
console.log(`#3 price rows (${v3.length}):` + (v3.length <= 45 ? '' : `\n  … (cycle-1 31 + cycle-3 only-Enugu = ${(31 + 1)} expected)`))
if (v3.length <= 45) for (const r of v3) console.log(`  b${r.branch_id} c${r.cycle_id} ₦${r.price}`)

await client.end()
console.log(DRY ? '\nDRY-RUN finished — no changes were written. Re-run without --dry to apply.' : '\nRepair complete.')
