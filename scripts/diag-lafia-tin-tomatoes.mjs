// READ-ONLY — find the duplicate "Tin Tomatoes Sarah 400g" on the Lafia branch.
// Prints every matching item, its Lafia pricing rows, overrides, markups and
// order references so the twin can be identified before anything is removed.
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

const branches = await c.query(`SELECT id, code, name, active FROM branches WHERE name ILIKE '%lafia%' OR code ILIKE '%LAF%' ORDER BY id`)
console.log('== branches matching Lafia ==')
console.table(branches.rows)

const items = await c.query(`
  SELECT item_id, sku, name, unit, category, is_active, source, image_url
  FROM items WHERE name ILIKE '%tin tomatoes%sarah%' OR name ILIKE '%sarah%400%' OR sku ILIKE '%SARAH%400%'
  ORDER BY item_id`)
console.log('== items matching Tin Tomatoes Sarah ==')
console.table(items.rows)

const itemIds = items.rows.map(r => r.item_id)
const lafiaIds = branches.rows.map(r => r.id)

if (itemIds.length && lafiaIds.length) {
  const prices = await c.query(`
    SELECT p.id, p.item_id, i.name, p.branch_id, b.name AS branch, p.cycle_id, p.price
    FROM branch_item_prices p
    JOIN items i ON i.item_id = p.item_id
    JOIN branches b ON b.id = p.branch_id
    WHERE p.item_id = ANY($1)
    ORDER BY p.branch_id, p.cycle_id, p.item_id`, [itemIds])
  console.log('== all pricing rows for these items ==')
  console.table(prices.rows)

  const ovs = await c.query(`
    SELECT o.*
    FROM item_branch_overrides o
    WHERE o.item_id = ANY($1) ORDER BY o.item_id, o.branch_id`, [itemIds])
  console.log('== item_branch_overrides ==')
  console.table(ovs.rows)

  const markups = await c.query(`
    SELECT id, item_id, branch_id, cycle_id, amount, active FROM branch_item_markups
    WHERE item_id = ANY($1) ORDER BY item_id, branch_id`, [itemIds])
  console.log('== branch_item_markups ==')
  console.table(markups.rows)

  const refs = await c.query(`
    SELECT ol.item_id, count(*)::int AS order_lines, min(o.created_at) AS first_at, max(o.created_at) AS last_at
    FROM order_lines ol JOIN orders o ON o.order_id = ol.order_id
    WHERE ol.item_id = ANY($1) GROUP BY ol.item_id ORDER BY ol.item_id`, [itemIds])
  console.log('== order_lines references ==')
  console.table(refs.rows)
}

if (itemIds.length) {
  const surveys = await c.query(`
    SELECT id, submission_id, item_name, price, saved_item_id, cancelled, created_at
    FROM food_survey_entries WHERE saved_item_id = ANY($1) ORDER BY id`, [itemIds])
  console.log('== food_survey_entries bound to these items ==')
  console.table(surveys.rows)
}

const cycle = await c.query(`SELECT id, code, is_active FROM cycles ORDER BY is_active DESC, id DESC LIMIT 3`)
console.log('== recent cycles ==')
console.table(cycle.rows)

await c.end()
console.log('DONE (read-only)')