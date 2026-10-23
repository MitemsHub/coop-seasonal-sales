// One-off fix for the Maiduguri "Bua Sugar 50Kg" mistake (2026-10-23).
//
// What happened: refining the Maiduguri survey draft "Sugar Premium Refines
// 50kg (BUA)" the admin saved it under the wrong product name (Bua Rice) —
// binding the sugar draft to item 85, the BUARICE50KG product shared by the
// Kano / Akure / Dutse / Jos drafts. A later edit renamed the shop copy to
// "Bua Sugar 50Kg"; the name-derived SKU collapses to BUASUGAR50KG, which
// item 357 (the real general "Bua Sugar 50Kg") already owns, so the server's
// rename-collision guard suffixed it → item 85 became BUASUGAR50KG-2 and the
// card shows the "-2" the admin keeps hitting.
//
// Ground truth (diag-bua-sugar.mjs, 2026-10-23):
//   item 357 BUASUGAR50KG   "Bua Sugar 50Kg" Sugar/Bag  general   (Damaturu 78,000 · cycle 3 only)
//   item 85  BUASUGAR50KG-2 "Bua Rice 50Kg"   Rice/Bag   outsourced (cycle 3: AKURE 60,500 / DUTSE 63,000 /
//                                                                 JOS 60,000 / KANO 61,000 / MAIDUGURI 78,000←sugar price)
//   overrides on 85: branch 18 MAIDUGURI → "Bua Sugar 50Kg" + sugar image (the mistake save);
//                    branches 27/30 → "Bua Rice 50Kg" + rice image (genuine)
//   survey entry 103 (Maiduguri sugar draft, 78,000) → saved_item_id 85   ← the wrong binding
//   survey entry 105 (Maiduguri "Rice 50kg (BUA)", 65,000) → unsaved
//   orders on 85: Kano/Damaturu cycle-1 delivered rice + one open cycle-3 JOS
//                 pending line @60,000 (genuine rice) — nothing Maiduguri.
//
// Fix (idempotent, backs up everything it touches first):
//   1. survey entry 103 → saved_item_id 357 (the draft belongs to real sugar)
//   2. Maiduguri gets item 357 priced 78,000 for cycle 3
//   3. item 85 loses the Maiduguri contamination (78,000 price row + sugar
//      name/image override) — rice is not a Maiduguri product this cycle,
//      the unsaved rice draft 105 stays available for the admin to refine
//   4. item 85's SKU restores to RICEBUA50KG (its original, matches the
//      RICEBUA50KG.png bank images and the RICEBUA25KG sibling naming)
//
// Usage: node scripts/fix-bua-sugar-maiduguri.mjs [--dry]
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry')

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

// ── Load everything the fix touches (also the backup) ───────────────────
const items = await c.query(
  `SELECT item_id, sku, name, category, unit, image_url, is_active, source
     FROM items WHERE item_id IN (85, 357)`)
const prices = await c.query(
  `SELECT * FROM branch_item_prices WHERE item_id IN (85, 357) ORDER BY item_id, branch_id, cycle_id`)
const overrides = await c.query(
  `SELECT * FROM item_branch_overrides WHERE item_id IN (85, 357) ORDER BY id`)
const entries = await c.query(
  `SELECT id, submission_id, item_name, category, price, saved_item_id, cancelled
     FROM food_survey_entries WHERE id IN (103, 105)`)
const maidOrders = await c.query(
  `SELECT ol.order_id, ol.qty, ol.unit_price, o.cycle_id
     FROM order_lines ol JOIN orders o ON o.order_id = ol.order_id
     JOIN branches b ON b.id = o.delivery_branch_id
    WHERE ol.item_id = 85 AND b.code = 'MAIDUGURI'`)

if (maidOrders.rows.length) {
  console.error('Maiduguri orders reference item 85 — aborting, the merge/undo story would change.')
  console.table(maidOrders.rows)
  await c.end()
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `scripts/bua-sugar-fix-backup-${stamp}.json`
fs.writeFileSync(backupPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  items: items.rows, prices: prices.rows, overrides: overrides.rows, survey_entries: entries.rows,
}, null, 2))
console.log(`Backup written: ${backupPath}`)

// ── Preconditions (fail loudly instead of half-applying) ────────────────
const sugarEntry = entries.rows.find(r => Number(r.id) === 103)
if (!sugarEntry) throw new Error('Survey entry 103 not found')
if (Number(sugarEntry.saved_item_id) !== 85) throw new Error(`Entry 103 already points at saved_item_id=${sugarEntry.saved_item_id} — nothing to fix`)
const riceSkuFree = !items.rows.some(r => r.sku === 'RICEBUA50KG')
if (!riceSkuFree) throw new Error('RICEBUA50KG is already taken — refusing to restore item 85')
// Cycle 3 must be active so the new Maiduguri price row lands in the right cycle
const cycle = await c.query(`SELECT id FROM cycles WHERE is_active ORDER BY id LIMIT 1`)
if (!cycle.rows.length || Number(cycle.rows[0].id) !== 3) throw new Error(`Active cycle is ${cycle.rows[0]?.id ?? 'none'}, expected 3`)

if (DRY) {
  console.log('\n--dry: would apply 4 statements, backup saved. Quitting.')
  await c.end()
  process.exit(0)
}

// ── Apply inside one transaction ────────────────────────────────────────
await c.query('BEGIN')
try {
  // 1. The Maiduguri sugar draft belongs to the real sugar item.
  await c.query(
    `UPDATE food_survey_entries SET saved_item_id = 357 WHERE id = 103 AND saved_item_id = 85`)

  // 2. Maiduguri prices the real sugar at the refined 78,000 for the cycle.
  await c.query(
    `INSERT INTO branch_item_prices (branch_id, item_id, price, cycle_id)
     SELECT 18, 357, 78000, 3
      WHERE NOT EXISTS (
        SELECT 1 FROM branch_item_prices
         WHERE branch_id = 18 AND item_id = 357 AND cycle_id = 3)`)

  // 3a. Remove the sugar price the mistake left on the rice item in Maiduguri.
  await c.query(
    `DELETE FROM branch_item_prices
      WHERE item_id = 85 AND branch_id = 18 AND cycle_id = 3 AND price = 78000`)

  // 3b. And the branch-scoped sugar name/image it painted on the rice card.
  await c.query(
    `DELETE FROM item_branch_overrides WHERE item_id = 85 AND branch_id = 18`)

  // 4. Restore the rice product's original SKU (clears the "-2" card).
  await c.query(
    `UPDATE items SET sku = 'RICEBUA50KG'
      WHERE item_id = 85 AND sku = 'BUASUGAR50KG-2'`)

  await c.query('COMMIT')

  // ── Verify ──────────────────────────────────────────────────────────
  const chkItems = await c.query(`SELECT item_id, sku, name FROM items WHERE item_id IN (85, 357) ORDER BY item_id`)
  const chkEntry = await c.query(`SELECT id, saved_item_id FROM food_survey_entries WHERE id IN (103, 105) ORDER BY id`)
  const chkPrices = await c.query(
    `SELECT b.code, i.sku, i.name, p.price, p.cycle_id
       FROM branch_item_prices p JOIN branches b ON b.id = p.branch_id JOIN items i ON i.item_id = p.item_id
      WHERE p.item_id IN (85, 357) AND p.branch_id = 18
      ORDER BY p.item_id`)
  const chkOv = await c.query(`SELECT branch_id, item_id, name FROM item_branch_overrides WHERE item_id = 85 ORDER BY id`)
  console.log('\nitems after fix:'); console.table(chkItems.rows)
  console.log('survey entries after fix:'); console.table(chkEntry.rows)
  console.log('Maiduguri price rows after fix (only sugar 78,000 expected):'); console.table(chkPrices.rows)
  console.log('item 85 overrides after fix (Kano/Jos rice expected):'); console.table(chkOv.rows)
} catch (e) {
  await c.query('ROLLBACK')
  console.error('FAILED, rolled back:', e.message)
  await c.end()
  process.exit(1)
}

await c.end()
