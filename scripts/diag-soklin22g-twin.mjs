// Read-only diagnostic for the So Klin 22g "-2" twin created on 2026-10-24.
// Shows every items row matching the Klin/So Klin family, which branches price
// them this cycle, their images, and which survey drafts point at them.
import 'dotenv/config'
import fs from 'node:fs'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^[\"']|[\"']$/g, ''); break }
    } catch {}
  }
}
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const fam = await c.query(`
  SELECT item_id, sku, name, category, unit, image_url, is_active,
         left(coalesce(source,''),10) src
    FROM items
   WHERE sku ILIKE '%KLIN%' OR name ILIKE '%klin%'
   ORDER BY sku`)
console.log('=== items rows ===')
for (const r of fam.rows) {
  console.log(`#${r.item_id} ${r.sku} | ${r.name} | cat=${r.category} unit=${r.unit} | active=${r.is_active} src=${r.src}`)
  console.log(`    img=${(r.image_url||'').slice(0,80)}`)
  console.log(`    created=${r.created_at?.toISOString?.() || r.created_at} updated=${r.updated_at?.toISOString?.() || r.updated_at}`)
}

const activeCycle = await c.query(`SELECT id, name FROM cycles WHERE is_active ORDER BY id DESC LIMIT 1`)
const cyc = activeCycle.rows[0]
console.log(`\n=== cycle ${cyc?.id} ("${cyc?.name}") pricing for these items ===`)
const prices = await c.query(`
  SELECT p.item_id, i.sku, b.code, p.price, p.cycle_id
    FROM branch_item_prices p
    JOIN branches b ON b.id = p.branch_id
    JOIN items i ON i.item_id = p.item_id
   WHERE i.sku ILIKE '%KLIN%'
   ORDER BY i.sku, b.code`)
for (const r of prices.rows) console.log(`#${r.item_id} ${r.sku} @ ${r.code} (cycle ${r.cycle_id}): price=${r.price}`)

console.log('\n=== survey drafts (Klin) linked to items ===')
const drafts = await c.query(`
  SELECT e.id, e.submission_id, e.item_name AS draft_name, e.price AS draft_price,
         e.saved_item_id, i.sku, s.branch_id, b.code AS branch_code,
         s.cycle_id, s.rep_name
    FROM food_survey_entries e
    JOIN food_survey_submissions s ON s.id = e.submission_id
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN items i ON i.item_id = e.saved_item_id
   WHERE e.item_name ILIKE '%klin%' OR i.sku ILIKE '%KLIN%'
   ORDER BY e.id`)
for (const r of drafts.rows) {
  console.log(`draft#${r.id} [${r.draft_name}] ${r.branch_code} cyc${r.cycle_id} rep=${r.rep_name} price=${r.draft_price}`)
  console.log(`    -> item#${r.saved_item_id} ${r.sku || '-'} | id-link-entry=${r.id}`)
}

console.log('\n=== item_branch_overrides for Klin items ===')
const ovr = await c.query(`
  SELECT o.item_id, i.sku, o.branch_id, b.code, o.name, o.image_url
    FROM item_branch_overrides o
    JOIN branches b ON b.id = o.branch_id
    JOIN items i ON i.item_id = o.item_id
   WHERE i.sku ILIKE '%KLIN%'
   ORDER BY i.sku, b.code`)
for (const r of ovr.rows) console.log(`#${r.item_id} ${r.sku} @ ${r.code}: override name='${r.name}' img=${(r.image_url||'').slice(60,110)}`)

console.log('\n=== which rows references Klin items (orders/order_lines) ===')
const refs = await c.query(`
  SELECT ol.item_id, i.sku, count(*) AS n
    FROM order_lines ol JOIN items i ON i.item_id = ol.item_id
   WHERE i.sku ILIKE '%KLIN%'
   GROUP BY ol.item_id, i.sku`)
for (const r of refs.rows) console.log(`#${r.item_id} ${r.sku}: ${r.n} order lines`)

await c.end()
