// READ-ONLY — full content of the Coop Secretariat submission (id 34) so we
// can review what will be replicated to Abuja + Head Office.
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
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const sub = await c.query(`
  SELECT s.*, b.name AS branch_name FROM food_survey_submissions s
  JOIN branches b ON b.id = s.branch_id WHERE s.id = 34`)
console.log('submission:', sub.rows[0])

const entries = await c.query(`
  SELECT id, catalog_id, item_name, category, price, saved_item_id, cancelled, photo_url
  FROM food_survey_entries WHERE submission_id = 34 ORDER BY id`)
console.log(`entries: ${entries.rows.length}`)
console.table(entries.rows.map(r => ({
  id: r.id, name: r.item_name, category: r.category, price: r.price,
  saved: r.saved_item_id, cancelled: r.cancelled,
  photo: r.photo_url ? r.photo_url.split('/').pop().slice(0, 40) : ''
})))

// Which of those entries' saved items are outsourced vs general?
const savedIds = entries.rows.map(r => r.saved_item_id).filter(v => v != null).map(Number)
if (savedIds.length) {
  const items = await c.query(`
    SELECT item_id, sku, name, source, is_active, image_url
    FROM items WHERE item_id = ANY($1) ORDER BY item_id`, [savedIds])
  console.log('\n== saved items for these entries ==')
  console.table(items.rows)
}

// Branch price spread for the saved items (Coop Sec vs Abuja vs HO already there?)
if (savedIds.length) {
  const prices = await c.query(`
    SELECT p.item_id, i.name, b.name AS branch, p.price
    FROM branch_item_prices p
    JOIN branches b ON b.id = p.branch_id
    JOIN items i ON i.item_id = p.item_id
    WHERE p.cycle_id = 3 AND p.branch_id IN (5, 37, 39) AND p.item_id = ANY($1)
    ORDER BY i.name, b.name`, [savedIds])
  console.log('\n== prices already in cycle 3 for Coop Sec (5) / Abuja (37) / Head Office (39) ==')
  console.table(prices.rows)
}

await c.end()
console.log('DONE (read-only)')
