// One-off fix for the Uyo "So Klin 22g / Klin 40g" twin (2026-10-24).
//
// What happened: refining the Uyo survey draft "Klin 22g" (entry 440, ₦9,300)
// the admin's first save adopted the WRONG picked bank identity — the row was
// born as "So Klin 40g" (SOKLIN40G → item 464, outsourced). Correcting the
// refined image/identity on the now-saved card renamed it to "So Klin 22g";
// the name-derived SKU SOKLIN22G is owned by item 463 (the real bank product),
// so the rename-collision guard suffixed it → item 464 became SOKLIN22G-2,
// spawning the "-2" twin (and the Image Bank picker now lists the twin as a
// bank row, e.g. "So Klin 40g · SOKLIN22G-2").
//
// Ground truth (diag-soklin22g-twin.mjs, 2026-10-24):
//   item 463 SOKLIN22G    "So Klin 22g"  Detergent/Carton  general     (unpriced)
//   item 464 SOKLIN22G-2  "So Klin 40g"  Detergent/Carton  outsourced  (UYO cycle-3 9,300)
//   override on 464: UYO → "So Klin 22g" + SOKLIN22G.png (the corrected save)
//   survey entry 440 (Uyo "Klin 22g" 9,300) → saved_item_id 464  ← the binding
//   survey entries 438 "Klin 170g/80g" and 439 "Klin 40g" stay unsaved
//   order lines referencing 464: NONE (checked; script aborts if any appear)
//
// Fix (idempotent, backs up everything it touches first):
//   1. survey entry 440 → saved_item_id 463 (the draft belongs to the real
//      "So Klin 22g" product)
//   2. Uyo's cycle-3 price row moves from item 464 to item 463 (same 9,300)
//   3. item 464 loses the Uyo override (name/image) and any leftover pricing
//   4. item 464 is DELETED outright — it has no order history, no survey
//      drafts, no pricing after the move: a row born from a mistaken pick
//      must not stay in the catalog (it pollutes the Image Bank picker).
//      Item 463 (the real product) is untouched.
//
// Usage: node scripts/fix-soklin22g-twin.mjs [--dry]
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry')

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^[\"']|[\"']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

// ── Load everything the fix touches (also the backup) ───────────────────
const items = await c.query(
  `SELECT item_id, sku, name, category, unit, image_url, is_active, source
     FROM items WHERE item_id IN (463, 464)`)
if (!items.rows.some((r) => r.item_id === 464)) {
  console.log('item 464 already gone — nothing to do.')
  await c.end()
  process.exit(0)
}
const prices = await c.query(
  `SELECT * FROM branch_item_prices WHERE item_id IN (463, 464) ORDER BY item_id, branch_id, cycle_id`)
const overrides = await c.query(
  `SELECT * FROM item_branch_overrides WHERE item_id = 464 ORDER BY id`)
const entries = await c.query(
  `SELECT id, submission_id, item_name, category, price, saved_item_id
     FROM food_survey_entries WHERE id = 440`)

// ── Safety: abort if item 464 is referenced anywhere we are not handling ──
const refTables = (await c.query(`
  SELECT DISTINCT table_name FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'item_id'
     AND table_name IN (SELECT table_name FROM information_schema.tables
                         WHERE table_schema = 'public' AND table_type = 'BASE TABLE')`)).rows
  .map((r) => r.table_name)
const handled = new Set(['items', 'branch_item_prices', 'branch_item_markups', 'item_branch_overrides', 'food_survey_entries'])
const dangerous = []
for (const t of refTables) {
  if (handled.has(t)) continue
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM "${t}" WHERE item_id = 464`)
  if (rows[0].n > 0) dangerous.push(`${t}: ${rows[0].n}`)
}
if (dangerous.length) {
  console.error('Aborting — item 464 is referenced outside the handled tables:', dangerous.join(', '))
  await c.end()
  process.exit(1)
}
const orderLines = (await c.query(`SELECT count(*)::int AS n FROM order_lines WHERE item_id = 464`)).rows[0].n
if (orderLines > 0) {
  console.error(`Aborting — ${orderLines} order_lines reference item 464 (would need a remap instead).`)
  await c.end()
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `scripts/soklin22g-twin-backup-${stamp}.json`
fs.writeFileSync(backupPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  items: items.rows, prices: prices.rows, overrides: overrides.rows, entries: entries.rows,
}, null, 2))
console.log(`Backup written to ${backupPath}\n`)

const uyoPrice = prices.rows.find((p) => p.item_id === 464)
const capt = (r) => console.log(`  #${r.item_id} ${r.sku} "${r.name}" (${r.source || ''})`)

console.log('Plan:')
capt(items.rows.find((r) => r.item_id === 463))
console.log('  ← item 463 stays as-is; adopt:')
entries.rows.forEach((e) => console.log(`  survey entry ${e.id} "${e.item_name}" 440→463 already? ${e.saved_item_id === 463}`))
if (uyoPrice) console.log(`  move Uyo pricing row (price=${uyoPrice.price}, cycle=${uyoPrice.cycle_id}) 464→463 (create if missing)`)
overrides.rows.forEach((o) => console.log(`  delete override id=${o.id}`))
console.log('  delete item 464 row')

if (DRY) { console.log('\n--dry: no changes written'); await c.end(); process.exit(0) }

console.log('\nApplying…')
// 1. Re-point the survey draft to the real product first.
const e1 = await c.query(`SELECT count(*)::int n, bool_or(saved_item_id = 463) ok FROM food_survey_entries WHERE id = 440`)
if (!e1.rows[0].ok || e1.rows[0].n !== 1) {
  await c.query(`UPDATE food_survey_entries SET saved_item_id = 463 WHERE id = 440`)
  console.log('  survey entry 440 → item 463')
} else {
  console.log('  survey entry 440 already → 463')
}

// 2. Move the Uyo price onto item 463 (upsert so re-runs are safe).
if (uyoPrice) {
  await c.query(`
    INSERT INTO branch_item_prices (branch_id, item_id, cycle_id, price)
    VALUES ($1, 463, $2, $3)
    ON CONFLICT (branch_id, item_id, cycle_id)
    DO UPDATE SET price = EXCLUDED.price
    WHERE branch_item_prices.price <> EXCLUDED.price`,
    [uyoPrice.branch_id, uyoPrice.cycle_id, uyoPrice.price])
  console.log(`  Uyo cycle-${uyoPrice.cycle_id} price ${uyoPrice.price} → item 463`)
}

// 3. Wipe item 464's pricing + overrides.
const dPrices = await c.query(`DELETE FROM branch_item_prices WHERE item_id = 464 RETURNING id`)
const dOvs = await c.query(`DELETE FROM item_branch_overrides WHERE item_id = 464 RETURNING id`)
console.log(`  deleted prices=[${dPrices.rows.length}] overrides=[${dOvs.rows.length}]`)
const mRes = await c.query(`DELETE FROM branch_item_markups WHERE item_id = 464`)
if (mRes.rowCount) console.log(`  deleted markups=[${mRes.rowCount}]`)

// 4. Delete the twin item row itself (no history anywhere by this point).
const check = await c.query(`
  SELECT (SELECT count(*)::int FROM order_lines WHERE item_id = 464) +
         (SELECT count(*)::int FROM branch_item_prices WHERE item_id = 464) +
         (SELECT count(*)::int FROM item_branch_overrides WHERE item_id = 464) +
         (SELECT count(*)::int FROM food_survey_entries WHERE saved_item_id = 464) AS n`)
if (check.rows[0].n > 0) {
  console.error('Aborting delete — references reappeared:', check.rows[0].n)
  await c.end()
  process.exit(1)
}
await c.query(`DELETE FROM items WHERE item_id = 464`)
console.log('  item 464 deleted')

// 5. Post-check summary.
const post = await c.query(`
  SELECT i.item_id, i.sku, i.name,
    (SELECT price FROM branch_item_prices p WHERE p.item_id = i.item_id AND p.branch_id = (SELECT id FROM branches WHERE code='UYO') AND p.cycle_id = 3) AS uyo_c3_price
     FROM items i WHERE i.sku ILIKE '%SOKLIN22%'`)
for (const r of post.rows) console.log(`POST: #${r.item_id} ${r.sku} "${r.name}" uyo_c3=${r.uyo_c3_price}`)
const draft = await c.query(`SELECT saved_item_id, (SELECT sku FROM items WHERE item_id = saved_item_id) AS sku FROM food_survey_entries WHERE id = 440`)
console.log(`POST: draft 440 → ${JSON.stringify(draft.rows)}`)

console.log('\nDone. Bust the Uyo shop cache:')
console.log(`  node scripts/bust-cache.mjs UYO  (if needed — saves already invalidate per branch)`)
await c.end()
