// One-off: correct the base catalog name of the surviving Lafia product so it
// reads "Tin Tomatoes Sarah 400g" everywhere, not just behind the Lafia override.
//
// Follow-up to scripts/fix-lafia-tin-tomatoes-twin.mjs (2026-10-28):
//   item 472 base name was "Tin Tomato Sarah 400g"  →  "Tin Tomatoes Sarah 400g"
//   item 472 SKU was TINTOMATOSARAH400G            →  TINTOMATOESSARAH400G
//   item 472 is priced ONLY on Lafia (branch 24, cycle 3, ₦34,000); the Lafia
//   override row already carries the correct spelling, so member-facing Lafia
//   never changes — this aligns the base row (admin lists, image bank, other
//   branch views) with it.
//
// The SKU swap is safe: items.sku is UNIQUE and TINTOMATOESSARAH400G was the
// deleted twin's SKU, now free (checked before writing). The stored image is
// already items/TINTOMATOESSARAH400G.png, so sku and image file end up
// matching again.
//
// Idempotent. Usage: node scripts/fix-lafia-tin-tomatoes-name.mjs [--dry]
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const KEEP = 472
const DUP = 471
const TARGET_NAME = 'Tin Tomatoes Sarah 400g'
const TARGET_SKU = 'TINTOMATOESSARAH400G'
const LAFIA_BRANCH_ID = 24

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

const dup = await c.query(`SELECT count(*)::int n FROM items WHERE item_id = $1`, [DUP])
if (dup.rows[0].n) { console.error(`Abort: duplicate ${DUP} is back — re-run the twin fix first.`); await c.end(); process.exit(1) }

const item = await c.query(`SELECT item_id, sku, name, is_active FROM items WHERE item_id = $1`, [KEEP])
if (!item.rows.length) { console.error(`Abort: item ${KEEP} missing.`); await c.end(); process.exit(1) }

// "Only for Lafia": this product must be priced on exactly one branch, Lafia.
const prices = await c.query(`
  SELECT p.branch_id, b.code, p.cycle_id, p.price FROM branch_item_prices p
  JOIN branches b ON b.id = p.branch_id WHERE p.item_id = $1 ORDER BY p.branch_id`, [KEEP])
const offLafia = prices.rows.filter((r) => r.branch_id !== LAFIA_BRANCH_ID)
if (offLafia.length) {
  console.error('Abort — item 472 is priced outside Lafia:', offLafia)
  await c.end(); process.exit(1)
}

console.log('Before:')
console.table(item.rows)
console.log('Priced branches (must be Lafia only):')
console.table(prices.rows)

if (item.rows[0].name === TARGET_NAME) {
  console.log(`\nName already "${TARGET_NAME}" — nothing to do.`)
} else if (DRY) {
  console.log(`\n--dry: would rename "${item.rows[0].name}" → "${TARGET_NAME}"`)
} else {
  await c.query(`UPDATE items SET name = $1 WHERE item_id = $2`, [TARGET_NAME, KEEP])
  console.log(`\nRenamed "${item.rows[0].name}" → "${TARGET_NAME}"`)
}

// ── Align the SKU (unique constraint on items.sku) ──────────────────────
const skuClash = await c.query(`SELECT item_id FROM items WHERE sku = $1 AND item_id <> $2`, [TARGET_SKU, KEEP])
if (skuClash.rows.length) {
  console.error(`\nAbort — SKU ${TARGET_SKU} is held by item ${skuClash.rows[0].item_id}; not renaming the SKU.`)
  await c.end(); process.exit(1)
}
if (item.rows[0].sku === TARGET_SKU) {
  console.log(`SKU already ${TARGET_SKU}.`)
} else if (DRY) {
  console.log(`--dry: would rename SKU ${item.rows[0].sku} → ${TARGET_SKU} (target is free)`)
} else {
  await c.query(`UPDATE items SET sku = $1 WHERE item_id = $2`, [TARGET_SKU, KEEP])
  console.log(`Renamed SKU ${item.rows[0].sku} → ${TARGET_SKU}`)
}

if (DRY) { await c.end(); process.exit(0) }

const after = await c.query(`SELECT item_id, sku, name, is_active FROM items WHERE item_id = $1`, [KEEP])
console.log('\nAfter:')
console.table(after.rows)

const ovr = await c.query(`SELECT id, branch_id, name, category, unit FROM item_branch_overrides WHERE item_id = $1`, [KEEP])
console.log('Lafia override (kept — now identical to base name):')
console.table(ovr.rows)

const view = await c.query(`
  SELECT item_id, item_name, sku, price, branch_code FROM v_inventory_status
  WHERE item_id = $1 ORDER BY branch_code, cycle_id`, [KEEP])
console.log('Where this product renders (v_inventory_status):')
console.table(view.rows)

await c.end()
console.log('\nDone. In-process cache TTL is 300s, so lists refresh within 5 minutes.')