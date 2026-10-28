// One-off fix: remove the duplicate "Tin Tomatoes Sarah 400g" catalog row that
// was added to the Lafia branch in error (2026-10-28).
//
// Ground truth (scripts/diag-lafia-tin-tomatoes.mjs):
//   item 471 TINTOMATOESSARAH400G  "Tin Tomatoes Sarah 400g"  general    ORPHAN
//          no branch_item_prices anywhere, no markups, no overrides,
//          no order_lines, no food_survey_entries → never was live.
//   item 472 TINTOMATOSARAH400G    "Tin Tomato Sarah 400g"    outsourced LIVE
//          Lafia price ₦34,000 (cycle 3, price row 4716), Lafia override
//          renders it as "Tin Tomatoes Sarah 400g", survey entry 1573.
//          This is the row members can actually buy — it stays.
//
// Fix: hard-delete item 471 only, after proving it is referenced nowhere.
// Idempotent: re-running finds nothing to do. Backs up what it touches first.
//
// Usage: node scripts/fix-lafia-tin-tomatoes-twin.mjs [--dry]
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const DUP = 471   // the mistaken duplicate
const KEEP = 472  // the live, correct product

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

const dup = await c.query(`SELECT item_id, sku, name, is_active, source FROM items WHERE item_id = $1`, [DUP])
const keep = await c.query(`SELECT item_id, sku, name, is_active, source FROM items WHERE item_id = $1`, [KEEP])

if (!dup.rows.length) {
  console.log(`item ${DUP} already gone — nothing to do.`)
  await c.end(); process.exit(0)
}
if (!keep.rows.length) {
  console.error(`Abort: the live item ${KEEP} is missing — refusing to touch anything.`)
  await c.end(); process.exit(1)
}

// The live row must still hold Lafia's price; otherwise "keep the live one"
// is not what this script would do.
const livePrice = await c.query(`
  SELECT p.id, p.price, p.cycle_id FROM branch_item_prices p
  WHERE p.item_id = $1 AND p.branch_id = 24`, [KEEP])
if (!livePrice.rows.length) {
  console.error('Abort: item 472 has no Lafia price row — it is not the live one. Re-diagnose.')
  await c.end(); process.exit(1)
}

// ── Safety: the duplicate must be referenced nowhere ────────────────────
const handled = new Set(['items'])
const refTables = (await c.query(`
  SELECT DISTINCT table_name FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'item_id'
     AND table_name IN (SELECT table_name FROM information_schema.tables
                         WHERE table_schema = 'public' AND table_type = 'BASE TABLE')`)).rows
  .map((r) => r.table_name)
const refs = []
for (const t of refTables) {
  if (handled.has(t)) continue
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM "${t}" WHERE item_id = $1`, [DUP])
  if (rows[0].n > 0) refs.push(`${t}: ${rows[0].n}`)
}
// Tables that point at the item by id under another column name.
const byName = await c.query(`
  SELECT (SELECT count(*)::int FROM food_survey_entries WHERE saved_item_id = $1) AS surveys,
         (SELECT count(*)::int FROM order_lines WHERE item_id = $1)              AS order_lines,
         (SELECT count(*)::int FROM items WHERE sku = (SELECT sku FROM items WHERE item_id = $1) AND item_id <> $1) AS sku_twins`, [DUP])
if (refs.length || byName.rows[0].surveys || byName.rows[0].order_lines) {
  console.error('Abort — duplicate is referenced somewhere:', refs.join(', ') || JSON.stringify(byName.rows[0]))
  await c.end(); process.exit(1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `scripts/lafia-tin-tomatoes-backup-${stamp}.json`
fs.writeFileSync(backupPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  duplicate: dup.rows,
  kept: keep.rows,
  lafia_price_on_kept: livePrice.rows,
  sku_twins: byName.rows[0].sku_twins,
}, null, 2))
console.log(`Backup written to ${backupPath}\n`)
console.log('Plan:')
console.log(`  DELETE items #${DUP}  ${dup.rows[0].sku} "${dup.rows[0].name}" (${dup.rows[0].source})  — 0 references`)
console.log(`  KEEP         #${KEEP}  ${keep.rows[0].sku} "${keep.rows[0].name}" — Lafia ₦${livePrice.rows[0].price} cycle ${livePrice.rows[0].cycle_id}`)

if (DRY) { console.log('\n--dry: no changes written'); await c.end(); process.exit(0) }

console.log('\nApplying…')
await c.query(`DELETE FROM items WHERE item_id = $1`, [DUP])
console.log(`  item ${DUP} deleted`)

const post = await c.query(`
  SELECT item_id, sku, name, is_active FROM items
  WHERE name ILIKE '%sarah%400%' OR sku ILIKE '%SARAH%400%' ORDER BY item_id`)
console.log('\nPOST — remaining Sarah 400g rows:')
console.table(post.rows)
const postPrice = await c.query(`
  SELECT p.id, i.name, p.price, p.cycle_id FROM branch_item_prices p
  JOIN items i ON i.item_id = p.item_id WHERE p.branch_id = 24 AND p.item_id = $1`, [KEEP])
console.log('POST — Lafia price row on the kept item:')
console.table(postPrice.rows)

await c.end()
console.log('\nDone. The member shop reads v_inventory_status (priced rows only), so the')
console.log('listing is unchanged — the orphan row never rendered. No cache bust needed.')