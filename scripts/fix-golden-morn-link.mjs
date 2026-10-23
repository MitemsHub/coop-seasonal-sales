// WRITES ONE ROW — relink survey entry 1412 ("Golden morn 30g carton",
// Ibadan, ₦18,000) to the saved outsourced item 401 ("Golden Morn 30g",
// priced ₦18,450 at Ibadan in the active cycle).
//
// Why: the admin saved the product but the survey link was never written
// (the rep's draft price was adjusted by the admin, so the price-only
// recovery can't recognize it, and "golden morn 30g carton" ≠
// "golden morn 30g" for the name fallback). An unlinked saved item falls
// into the trailing "Saved items — no survey draft" group, which sorts
// last — the card the admin saw buried on the last branch page.
//
// Guards before writing (abort if any check fails):
//   - entry 1412 exists, not cancelled, saved_item_id IS NULL
//   - item 401 exists, is_active, source='outsourced'
//   - no other entry is already linked to item 401
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

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

const ENTRY_ID = 1412
const ITEM_ID = 401

const e = await c.query(
  `SELECT e.id, e.item_name, e.price, e.cancelled, e.saved_item_id, s.branch_id, b.name AS branch
   FROM food_survey_entries e JOIN food_survey_submissions s ON s.id = e.submission_id
   LEFT JOIN branches b ON b.id = s.branch_id WHERE e.id = $1`, [ENTRY_ID])
const entry = e.rows[0]
if (!entry) { console.error('entry not found'); process.exit(1) }
if (entry.cancelled) { console.error('entry is cancelled — aborting'); process.exit(1) }
if (entry.saved_item_id != null) { console.log('entry already linked to', entry.saved_item_id, '— nothing to do'); process.exit(0) }

const it = await c.query(`SELECT item_id, name, source, is_active FROM items WHERE item_id = $1`, [ITEM_ID])
const item = it.rows[0]
if (!item) { console.error('item not found'); process.exit(1) }
if (item.source !== 'outsourced') { console.error('item is not outsourced — aborting'); process.exit(1) }
if (item.is_active === false) { console.error('item is inactive — aborting'); process.exit(1) }

const dup = await c.query(`SELECT id, item_name FROM food_survey_entries WHERE saved_item_id = $1`, [ITEM_ID])
if (dup.rows.length) { console.error('item already claimed by entries', JSON.stringify(dup.rows), '— aborting'); process.exit(1) }

console.log('Linking:', JSON.stringify({ entry: entry.item_name, price: entry.price, branch: entry.branch }, null, 1))
console.log('   to:', JSON.stringify(item))
const upd = await c.query(
  `UPDATE food_survey_entries SET saved_item_id = $1 WHERE id = $2 AND saved_item_id IS NULL`,
  [ITEM_ID, ENTRY_ID])
console.log('updated rows:', upd.rowCount)

// ── Read-only sweep: any OTHER saved outsourced item with no draft link ──
const cycle = await c.query(`SELECT id FROM cycles WHERE is_active = TRUE LIMIT 1`)
const cycleId = cycle.rows[0]?.id

const sweep = await c.query(`
  WITH outsourced AS (
    SELECT i.item_id, i.name FROM items i WHERE i.source = 'outsourced' AND COALESCE(i.is_active, TRUE)
  ),
  linked AS (SELECT DISTINCT saved_item_id AS item_id FROM food_survey_entries WHERE saved_item_id IS NOT NULL),
  orphan_items AS (SELECT o.* FROM outsourced o LEFT JOIN linked l USING (item_id) WHERE l.item_id IS NULL)
  SELECT oi.item_id, oi.name,
           (SELECT array_agg(DISTINCT b.name) FROM branch_item_prices p JOIN branches b ON b.id = p.branch_id
             WHERE p.item_id = oi.item_id AND p.cycle_id = $1) AS priced_at
  FROM orphan_items oi`, [cycleId])
const orphans = sweep.rows
console.log(`\n== orphaned saved items (no draft link) in cycle ${cycleId}: ${orphans.length} ==`)

const draftSweep = await c.query(`
  SELECT e.id AS entry_id, e.item_name, e.price, s.branch_id, b.name AS branch
  FROM food_survey_entries e
  JOIN food_survey_submissions s ON s.id = e.submission_id
  JOIN branches b ON b.id = s.branch_id
  WHERE s.cycle_id = $1 AND e.saved_item_id IS NULL AND e.cancelled IS NOT TRUE`, [cycleId])
const nameTokens = (n) => String(n).toLowerCase().match(/\d+(?:\.\d+)?\s*[a-z]+/g) || []
for (const o of orphans) {
  console.log(`item ${o.item_id} "${o.name}" priced at`, JSON.stringify(o.priced_at))
  const ot = nameTokens(o.name)
  const cands = draftSweep.rows.filter((d) =>
    (o.priced_at || []).includes(d.branch) && nameTokens(d.item_name).some((t) => ot.some((x) => x === t)))
  if (cands.length) console.log(`  ↳ candidate drafts:`, JSON.stringify(cands))
}

await c.end()
console.log('DONE')
