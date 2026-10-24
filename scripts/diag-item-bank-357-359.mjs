import pg from 'pg'
import fs from 'fs'

let url = process.env.SUPABASE_DB_URL
if (!url) {
  for (const f of ['.env.local', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { url = m[1].trim().replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const items = await c.query(
  `SELECT item_id, sku, name, category, unit, source, is_active, image_url
   FROM items WHERE item_id IN (85, 357, 359) ORDER BY item_id`
)
console.log('== items rows ==')
console.table(items.rows)

const entries = await c.query(
  `SELECT e.id, e.item_name, e.category, e.price, e.saved_item_id, e.cancelled, b.code branch, s.cycle_id
   FROM food_survey_entries e
   JOIN food_survey_submissions s ON s.id = e.submission_id
   JOIN branches b ON b.id = s.branch_id
   WHERE e.saved_item_id IN (85, 357, 359) OR e.item_name ILIKE '%bua%' OR e.item_name ILIKE '%viva%'
   ORDER BY e.saved_item_id, b.code`
)
console.log('== survey entries mentioning bua/viva or bound to 85/357/359 ==')
console.table(entries.rows)

const prices = await c.query(
  `SELECT b.code, p.item_id, p.price, p.cycle_id
   FROM branch_item_prices p JOIN branches b ON b.id = p.branch_id
   WHERE p.item_id IN (85, 357, 359) ORDER BY p.item_id, b.code`
)
console.log('== branch_item_prices for 85/357/359 ==')
console.table(prices.rows)

const overrides = await c.query(
  `SELECT branch_id, item_id, name, category, unit, image_url FROM item_branch_overrides WHERE item_id IN (85, 357, 359)`
)
console.log('== item_branch_overrides for 85/357/359 ==')
console.table(overrides.rows)

await c.end()
