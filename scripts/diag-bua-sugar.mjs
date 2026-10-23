// READ-ONLY diagnostic for the "Bua Sugar 50Kg" / BUASUGAR50KG-2 case.
//
// Question: after the admin saved the Maiduguri rep draft under the refined
// name "Bua Sugar 50Kg", the saved card showed SKU BUASUGAR50KG-2. Why?
// Working hypothesis (route.js rename-collision guard): on save the client
// derives sku BUASUGAR50KG from the refined name, another item already owns
// that SKU, so instead of failing the save the server suffixed it (-2).
// This script dumps the owners of those SKUs, both items' pricing rows and
// the Maiduguri survey entry, so the actual twin situation is visible.
//
// Usage: node scripts/diag-bua-sugar.mjs   (no writes anywhere)
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

const like = '%BUASUG%'
const q1 = await c.query(
  `SELECT item_id, sku, name, category, unit, is_active, source
   FROM items WHERE sku ILIKE $1 OR name ILIKE '%bua %' ORDER BY sku`, [like])
console.log('\n== items matching BUASUG* or "bua %" ==')
console.table(q1.rows)

const ids = q1.rows.filter(r => r.sku?.startsWith('BUASUG')).map(r => r.item_id)
if (ids.length) {
  const q2 = await c.query(
    `SELECT i.item_id, i.sku, i.name, b.code AS branch_code, b.name AS branch,
            p.price, m.active AS markup_active, m.amount AS markup, p.cycle_id
       FROM branch_item_prices p
       JOIN branches b ON b.id = p.branch_id
       JOIN items i ON i.item_id = p.item_id
       LEFT JOIN branch_item_markups m
         ON m.item_id = p.item_id AND m.branch_id = p.branch_id AND m.cycle_id = p.cycle_id
      WHERE p.item_id = ANY($1)
      ORDER BY i.sku, b.code, p.cycle_id`, [ids])
  console.log('\n== branch pricing rows for the BUASUG items ==')
  console.table(q2.rows)

  const q3 = await c.query(`
  SELECT ol.item_id, count(*) AS lines, sum(ol.qty) AS qty, min(o.created_at)::date AS first_order, max(o.created_at)::date AS last_order
    FROM order_lines ol JOIN orders o ON o.order_id = ol.order_id
   WHERE ol.item_id = ANY($1)
   GROUP BY ol.item_id`, [ids])
  console.log('\n== order history for the BUASUG items ==')
  console.table(q3.rows)

  const q3b = await c.query(`
  SELECT o.order_id, o.cycle_id, b.code AS branch_code, o.status, o.created_at::date AS placed, ol.qty, ol.unit_price
    FROM order_lines ol
    JOIN orders o ON o.order_id = ol.order_id
    LEFT JOIN branches b ON b.id = o.delivery_branch_id
   WHERE ol.item_id = ANY($1)
   ORDER BY o.created_at DESC
   LIMIT 25`, [ids])
  console.log('\n== individual order lines (latest 25) ==')
  console.table(q3b.rows)

  const qov = await c.query(`
  SELECT * FROM item_branch_overrides WHERE item_id = ANY($1) ORDER BY branch_id, item_id`, [ids])
  console.log('\n== item_branch_overrides for the BUASUG items ==')
  console.table(qov.rows)

  const qse = await c.query(`
  SELECT s.id AS submission_id, s.cycle_id, s.rep_name, s.created_at::date AS submitted,
         e.id AS entry_id, e.item_name, e.category, e.price, e.saved_item_id, e.cancelled,
         b.code AS branch_code
    FROM food_survey_submissions s
    JOIN food_survey_entries e ON e.submission_id = s.id
    LEFT JOIN branches b ON b.id = s.branch_id
   WHERE (e.saved_item_id = ANY($1) OR e.item_name ILIKE '%bua%')
   ORDER BY s.id`, [ids])
  console.log('\n== survey drafts pointing at (or matching) the BUASUG items ==')
  console.table(qse.rows)
}

const q4 = await c.query(
  `SELECT e.id AS entry_id, e.cycle_id, e.branch_id, b.code AS branch_code, b.name AS branch,
          e.draft_name, e.draft_category, e.draft_unit, e.draft_price,
          e.saved_item_id, e.cancelled, e.updated_at
     FROM food_survey_entries e
     LEFT JOIN branches b ON b.id = e.branch_id
    WHERE e.draft_name ILIKE '%bua%' OR e.draft_name ILIKE '%sugar%'
    ORDER BY e.id`)
console.log('\n== food_survey_entries matching bua/sugar ==')
console.table(q4.rows)

const q5 = await c.query(
  `SELECT i.item_id, i.sku, p.cycle_id, b.code AS branch_code, p.price
     FROM branch_item_prices p
     JOIN branches b ON b.id = p.branch_id
     JOIN items i ON i.item_id = p.item_id
    WHERE b.code = 'MAID' AND i.sku ILIKE '%BUA%'
    ORDER BY i.sku, p.cycle_id`)
console.log('\n== Maiduguri price rows for any BUA* item ==')
console.table(q5.rows)

await c.end()
