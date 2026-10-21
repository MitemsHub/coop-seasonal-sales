// READ-ONLY — diagnose the "Golden Penny Spaghetti shows as outsourced" complaint
// and survey drafts for Coop Secretariat / Abuja / Head Office branches.
// Real schema (confirmed via information_schema):
//   items(item_id, sku, name, unit, category, is_active, image_url, department_id, source)
//   branches(id, code, name, active, ...)
//   cycles(id, code, ..., survey_open)
//   food_survey_submissions(id, rep_name, branch_id, cycle_id, source, notes, created_at, phone)
//   food_survey_entries(id, submission_id, catalog_id, item_name, category, price, photo_url, created_at, saved_item_id, cancelled)
//   branch_item_prices(id, branch_id, item_id, price, cycle_id)
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

const q1 = await c.query(`
  SELECT item_id, sku, name, unit, category, is_active, image_url, source
  FROM items WHERE name ILIKE '%spaghetti%' ORDER BY item_id`)
console.log('\n== items matching spaghetti ==')
console.table(q1.rows)

if (q1.rows.length === 0) { await c.end(); process.exit(0) }
const itemIds = q1.rows.map(r => r.item_id)

const qAct = await c.query(`SELECT id, code, survey_open FROM cycles WHERE is_active = TRUE ORDER BY id DESC LIMIT 1`)
const activeCycle = qAct.rows[0]?.id ?? null
console.log('\nactive cycle:', qAct.rows)

const q2 = await c.query(`
  SELECT b.id AS branch_id, b.name AS branch, b.code AS branch_code,
         p.cycle_id, p.price
  FROM branch_item_prices p
  JOIN branches b ON b.id = p.branch_id
  WHERE p.item_id = ANY($1)
    AND (p.cycle_id = $2 OR p.cycle_id IS NULL)
  ORDER BY b.name, p.price`, [itemIds, activeCycle])
console.log('\n== branch_item_prices (active cycle or perpetual) ==')
console.table(q2.rows)

const q3 = await c.query(`
  SELECT s.id AS submission_id, s.cycle_id, b.name AS branch, s.rep_name, s.created_at,
         e.id AS entry_id, e.saved_item_id, e.item_name AS draft_name, e.price AS draft_price,
         e.photo_url, e.cancelled
  FROM food_survey_entries e
  JOIN food_survey_submissions s ON s.id = e.submission_id
  JOIN branches b ON b.id = s.branch_id
  WHERE e.saved_item_id = ANY($1) OR e.item_name ILIKE '%spaghetti%'
  ORDER BY s.cycle_id DESC NULLS LAST, b.name`, [itemIds])
console.log('\n== survey entries mentioning these items (all cycles) ==')
console.table(q3.rows)

const q4 = await c.query(`
  SELECT b.id, b.name, b.code, b.rep_phone,
         (SELECT COUNT(*) FROM food_survey_submissions s
           WHERE s.branch_id = b.id) AS all_subs
  FROM branches b
  WHERE b.name ILIKE '%abuja%' OR b.name ILIKE '%head office%' OR b.name ILIKE '%secretariat%'
  ORDER BY b.name`)
console.log('\n== branches of interest + submission counts ==')
console.table(q4.rows)

const q5 = await c.query(`
  SELECT s.id AS submission_id, s.cycle_id, b.name AS branch, s.rep_name, s.source, s.created_at,
         COUNT(e.id) AS entry_rows,
         COUNT(e.saved_item_id) AS saved_rows
  FROM food_survey_submissions s
  JOIN branches b ON b.id = s.branch_id
  LEFT JOIN food_survey_entries e ON e.submission_id = s.id
  WHERE b.name ILIKE '%abuja%' OR b.name ILIKE '%head office%' OR b.name ILIKE '%secretariat%'
  GROUP BY s.id, s.cycle_id, b.name, s.rep_name, s.source, s.created_at
  ORDER BY b.name, s.cycle_id DESC NULLS LAST, s.created_at DESC`)
console.log('\n== submissions for those branches (all) ==')
console.table(q5.rows)

await c.end()
console.log('DONE (read-only)')
