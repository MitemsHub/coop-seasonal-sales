// WRITE SCRIPT — retire the dead general-item twin of "Fresh Red Oil 5L".
// Item #360 (sku RETIRED-FRESHREDOIL5L-GENERAL) has no branch price rows and no
// live shop presence; it only exists to trip the outsourced-duplicate check.
// Setting is_active=false makes General vs Outsourced matching clean again.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^[\"']|[\"']$/g, ''); break }
    } catch {}
  }
}
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (sql, params = []) => (await c.query(sql, params)).rows

const item = (await q(`SELECT item_id, sku, name, is_active, image_url FROM items WHERE item_id = 360`))[0]
if (!item) { console.error('Item #360 not found — aborting, nothing written.'); await c.end(); process.exit(1) }

console.log('Before:', JSON.stringify(item))

// Safety: confirm #360 has no live shop surface. Any of these existing means
// we re-evaluate instead of retiring.
const refs = {
  prices: (await q(`SELECT COUNT(*)::int AS n FROM branch_item_prices WHERE item_id = 360`))[0].n,
  orderLines: (await q(`SELECT COUNT(*)::int AS n FROM order_lines WHERE item_id = 360 AND qty > 0`))[0].n,
  surveySaving: (await q(
    `SELECT COUNT(*)::int AS n FROM food_survey_entries WHERE saved_item_id = 360 AND COALESCE(cancelled, false) = false`
  ))[0].n,
}
console.log('References:', JSON.stringify(refs))

if (item.is_active === false) {
  console.log('Already retired — no write needed.')
} else if (refs.prices > 0) {
  console.log('✖ Refusing: item #360 has branch price rows. Retiring would break live pricing.')
} else if (refs.orderLines > 0) {
  console.log('✖ Refusing: item #360 is referenced by order lines. Leave it active (historical data).')
} else if (refs.surveySaving > 0) {
  console.log('✖ Refusing: a live survey entry still saves to item #360.')
} else {
  await q(`UPDATE items SET is_active = false WHERE item_id = 360`)
  const after = (await q(`SELECT item_id, sku, name, is_active FROM items WHERE item_id = 360`))[0]
  console.log('After:', JSON.stringify(after))
  console.log('✔ Item #360 retired (is_active=false). SKU already carries the RETIRED- tombstone.')
}

await c.end()
console.log('DONE')
