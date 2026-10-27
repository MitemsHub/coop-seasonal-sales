// READ-ONLY — diagnose two shop-preview complaints:
//  1) "Kings Oil 5L" (outsourced, worked-on/in-shop) missing from Lagos preview
//  2) "Golden Morn 45G" (general) showing OUTSOURCED badge in Lagos preview
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

const act = await c.query(`SELECT id, code, is_active FROM cycles WHERE is_active = TRUE ORDER BY id DESC LIMIT 1`)
const cycleId = act.rows[0]?.id ?? null
console.log('active cycle:', act.rows)

const lagos = await c.query(`SELECT id, code, name FROM branches WHERE name ILIKE '%lagos%' OR code ILIKE '%lagos%'`)
console.log('lagos branch:', lagos.rows)
const lagosId = lagos.rows[0]?.id ?? null

// ── 1. The items themselves ────────────────────────────────────────────
const items = await c.query(
  `SELECT item_id, sku, name, category, unit, is_active, source, image_url
   FROM items WHERE name ILIKE '%kings%oil%' OR name ILIKE '%golden morn%'
      OR sku ILIKE '%KINGS5L%' OR sku ILIKE '%GMORN45%' OR sku ILIKE '%GOLDENMORN45%'
   ORDER BY item_id`)
console.log('\n== candidate items ==')
console.table(items.rows)
const itemIds = items.rows.map(r => r.item_id)

// ── 2. Prices in Lagos (active cycle) for those items ──────────────────
if (lagosId) {
  const p = await c.query(
    `SELECT p.item_id, i.name, p.cycle_id, p.price, p.branch_id
     FROM branch_item_prices p JOIN items i ON i.item_id = p.item_id
     WHERE p.branch_id = $1 AND p.item_id = ANY($2)
     ORDER BY p.item_id, p.cycle_id`, [lagosId, itemIds])
  console.log('\n== Lagos prices for candidate items ==')
  console.table(p.rows)

  const cnt = await c.query(
    `SELECT p.item_id, i.name, COUNT(*) AS priced_branches
     FROM branch_item_prices p JOIN items i ON i.item_id = p.item_id
     WHERE p.item_id = ANY($1) AND p.price > 0
       AND ($2::int IS NULL OR p.cycle_id = $2 OR p.cycle_id IS NULL)
     GROUP BY p.item_id, i.name ORDER BY p.item_id`, [itemIds, cycleId])
  console.log('\n== how many branches price each candidate ==')
  console.table(cnt.rows)
}

// ── 3. v_inventory_status rows for Lagos (what the preview actually reads)
if (lagosId) {
  const lagosRow = await c.query(`SELECT code FROM branches WHERE id = $1`, [lagosId])
  const code = lagosRow.rows[0]?.code
  const v = await c.query(
    `SELECT item_id, item_name, price, cycle_id
     FROM v_inventory_status
     WHERE branch_code = $1 AND item_id = ANY($2)
     ORDER BY item_id`, [code, itemIds]).catch(e => ({ rows: [{ err: e.message }] }))
  console.log('\n== v_inventory_status for Lagos ==')
  console.table(v.rows)
}

// ── 4. Survey entries linked to those items (cancel-hiding suspect) ─────
const links = await c.query(
  `SELECT e.id AS entry_id, e.item_name AS draft_name, e.cancelled, e.saved_item_id,
          e.price AS draft_price, s.id AS submission_id, s.cycle_id, s.rep_name,
          b.id AS branch_id, b.name AS branch
   FROM food_survey_entries e
   JOIN food_survey_submissions s ON s.id = e.submission_id
   JOIN branches b ON b.id = s.branch_id
   WHERE e.saved_item_id = ANY($1) OR e.item_name ILIKE '%kings%oil%'
      OR e.item_name ILIKE '%golden morn 45%'
   ORDER BY b.name, s.cycle_id DESC NULLS LAST, e.id`, [itemIds])
console.log('\n== survey entries linked/named like these items ==')
console.table(links.rows)

// ── 5. Specifically: cancelled entries in Lagos that hide these items ───
if (lagosId) {
  const hid = await c.query(
    `SELECT e.id AS entry_id, e.item_name, e.cancelled, e.saved_item_id,
            i.name AS saved_item_name, i.source, s.cycle_id, s.rep_name
     FROM food_survey_entries e
     JOIN food_survey_submissions s ON s.id = e.submission_id
     JOIN items i ON i.item_id = e.saved_item_id
     WHERE s.branch_id = $1
       AND e.cancelled = TRUE
       AND e.saved_item_id = ANY($2)
       AND ($3::int IS NULL OR s.cycle_id = $3 OR s.cycle_id IS NULL)`,
    [lagosId, itemIds, cycleId])
  console.log('\n== CANCELLED Lagos entries whose saved_item hides a candidate item (active cycle) ==')
  console.table(hid.rows)
}

await c.end()
console.log('\nDONE (read-only)')
