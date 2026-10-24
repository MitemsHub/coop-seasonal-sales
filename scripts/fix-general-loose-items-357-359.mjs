// One-off reclassification (2026-10-24).
//
// What happened: "Bua Sugar 50Kg" (item 357) and "Viva Plus 20g" (item 359)
// sit in the items bank flagged source='general' — the section that promises
// a product is priced in EVERY branch for the cycle — but they were only
// ever priced by the branches whose rep survey drafts were refined onto
// them (357: Damaturu + Maiduguri; 359: Kano, Katsina, Damaturu, Maiduguri).
// The branch-card refine flow reuses an existing bank row without touching
// its source flag, so the rows stayed '_general' in the Items Import General
// list while the shops only saw them in a few branches.
//
// Fix: flip both products to source='outsourced' (branch-scoped, like every
// other survey-refined product) and give every branch that prices them an
// item_branch_overrides row (copying the current shared name/category/unit/
// image) so each branch card shows its own display fields. Prices, cycles,
// and shop visibility are untouched.
//
// Report-only sweep: list any OTHER source='general' item priced in fewer
// active branches than exist for the active cycle, so nothing else hides
// with the same mismatch.
//
// Usage: node scripts/fix-general-loose-items-357-359.mjs [--dry]
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

const ids = [357, 359]
const items = await c.query(
  `SELECT item_id, sku, name, category, unit, source, is_active, image_url FROM items WHERE item_id = ANY($1)`, [ids])
const prices = await c.query(
  `SELECT * FROM branch_item_prices WHERE item_id = ANY($1) ORDER BY item_id, branch_id, cycle_id`, [ids])
const overrides = await c.query(
  `SELECT * FROM item_branch_overrides WHERE item_id = ANY($1) ORDER BY item_id, branch_id`, [ids])

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `scripts/items-357-359-reclass-backup-${stamp}.json`
fs.writeFileSync(backupPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  items: items.rows, prices: prices.rows, overrides: overrides.rows,
}, null, 2))
console.log(`Backup written: ${backupPath}`)

// ── Preconditions ────────────────────────────────────────────────────────
for (const it of items.rows) {
  if ((it.source || 'general') !== 'general') throw new Error(`item ${it.item_id} is ${it.source ?? 'NULL'}, expected 'general' — nothing to fix`)
}
const cycle = await c.query(`SELECT id FROM cycles WHERE is_active ORDER BY id LIMIT 1`)
const activeCycle = cycle.rows[0] ? Number(cycle.rows[0].id) : null
if (!activeCycle) throw new Error('No active cycle found')

if (DRY) {
  await c.query('ROLLBACK')
  await c.end()
  process.exit(0)
}

// ── Apply inside one transaction ─────────────────────────────────────────
await c.query('BEGIN')
try {
  await c.query(
    `UPDATE items SET source = 'outsourced' WHERE item_id = ANY($1) AND COALESCE(source,'general') = 'general'`, [ids])

  // Every branch that currently prices these items keeps its own display copy.
  const ovRes = await c.query(
    `INSERT INTO item_branch_overrides (branch_id, item_id, name, category, unit, image_url)
     SELECT p.branch_id, p.item_id, i.name, i.category, i.unit, i.image_url
       FROM branch_item_prices p
       JOIN items i ON i.item_id = p.item_id
      WHERE p.item_id = ANY($1) AND p.cycle_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM item_branch_overrides o
           WHERE o.branch_id = p.branch_id AND o.item_id = p.item_id)`, [ids, activeCycle])
  console.log(`Overrides inserted: ${ovRes.rowCount}`)

  await c.query('COMMIT')
} catch (e) {
  await c.query('ROLLBACK')
  console.error('FAILED, rolled back:', e.message)
  await c.end()
  process.exit(1)
}

// ── Verify ───────────────────────────────────────────────────────────────
const chkItems = await c.query(
  `SELECT item_id, sku, name, source FROM items WHERE item_id = ANY($1) ORDER BY item_id`, [ids])
const chkOv = await c.query(
  `SELECT p.item_id, b.code AS priced_branch,
          CASE WHEN o.branch_id IS NULL THEN 'MISSING' ELSE 'override' END AS display
     FROM branch_item_prices p
     JOIN branches b ON b.id = p.branch_id
     LEFT JOIN item_branch_overrides o ON o.branch_id = p.branch_id AND o.item_id = p.item_id
    WHERE p.item_id = ANY($1) AND p.cycle_id = $2
    ORDER BY p.item_id, b.code`, [ids, activeCycle])
console.log('items after fix:'); console.table(chkItems.rows)
console.log('display coverage per priced branch:'); console.table(chkOv.rows)

// ── Sweep: any other 'general' item not priced in every branch this cycle? ──
const branchCount = (await c.query(`SELECT COUNT(*)::int AS n FROM branches`)).rows[0].n
const loose = await c.query(
  `SELECT i.item_id, i.sku, i.name, COUNT(DISTINCT p.branch_id)::int AS priced_branches
     FROM items i
     JOIN branch_item_prices p ON p.item_id = i.item_id AND p.cycle_id = $2
    WHERE COALESCE(i.source,'general') = 'general' AND COALESCE(i.is_active, TRUE)
      AND i.item_id <> ALL($1)
    GROUP BY i.item_id, i.sku, i.name
   HAVING COUNT(DISTINCT p.branch_id) < $3
    ORDER BY priced_branches, i.item_id`, [ids, activeCycle, branchCount])
console.log(`\nSweep: ${loose.rows.length} other 'general' item(s) priced in a subset of the ${branchCount} branches for cycle ${activeCycle}:`)
console.table(loose.rows)

await c.end()
