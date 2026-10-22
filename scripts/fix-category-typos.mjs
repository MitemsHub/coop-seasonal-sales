// One-shot data fix for category typos the admin flagged (22 Oct 2026):
//   • items.category  'RIce' → 'Rice'  (typo duplicate of the Rice family)
//   • food_survey_catalog.category  'Oils' → 'Vegetable Oil'  (matches the
//     items table's vocabulary — items have used 'Vegetable Oil' since the
//     King's Oil cleanup; the survey catalog was never renamed)
//   • food_survey_entries.category  'Oils' → 'Vegetable Oil'  (same rename on
//     the saved draft labels so new pre-fills stay consistent)
// Idempotent: re-running changes nothing. Prints rows before and after.
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
const q = async (sql, params = []) => (await c.query(sql, params)).rows

const beforeItems = await q(`SELECT item_id, sku, name FROM items WHERE category = 'RIce'`)
console.log('items with category RIce:', beforeItems.map((r) => `#${r.item_id} ${r.name} (${r.sku})`).join(' | ') || '(none)')
if (beforeItems.length) {
  const r = await q(`UPDATE items SET category = 'Rice' WHERE category = 'RIce' RETURNING item_id, name`)
  console.log(`→ renamed to Rice: ${r.length} item(s)`)
}

const beforeCatalog = await q(`SELECT id, name FROM food_survey_catalog WHERE category = 'Oils'`)
console.log('survey catalog rows with category Oils:', beforeCatalog.map((r) => `#${r.id} ${r.name}`).join(' | ') || '(none)')
if (beforeCatalog.length) {
  const r = await q(`UPDATE food_survey_catalog SET category = 'Vegetable Oil' WHERE category = 'Oils' RETURNING id, name`)
  console.log(`→ renamed to Vegetable Oil: ${r.length} catalog row(s)`)
}

const beforeEntries = await q(`SELECT id, item_name FROM food_survey_entries WHERE category = 'Oils' AND COALESCE(cancelled,false) = false`)
console.log('live survey entries labelled Oils:', beforeEntries.map((r) => `#${r.id} ${r.item_name}`).join(' | ') || '(none)')
if (beforeEntries.length) {
  const r = await q(`UPDATE food_survey_entries SET category = 'Vegetable Oil' WHERE category = 'Oils' RETURNING id`)
  console.log(`→ relabelled: ${r.length} entry(ies)`)
}

const after = await q(`SELECT category, COUNT(*)::int AS n FROM items WHERE COALESCE(category,'') <> '' GROUP BY category ORDER BY n DESC`)
console.log('items categories after fix:', after.map((r) => `${r.category}(${r.n})`).join(', '))

await c.end()
console.log('DONE')
