// READ-ONLY census of category vocabulary across every table that stores one.
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
const q = async (sql, params = []) => (await c.query(sql, params)).rows

const tables = [
  ['items', 'category'],
  ['food_survey_catalog', 'category'],
  ['food_survey_entries', 'category'],
  ['item_branch_overrides', 'category'],
  ['item_taxonomy', 'value'],
]

for (const [table, col] of tables) {
  try {
    const exists = await q(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 AND table_schema='public'`, [table, col])
    if (!exists.length) { console.log(`${table}.${col}: (column missing)`); continue }
    const rows = await q(`SELECT ${col} AS v, COUNT(*)::int AS n FROM ${table} WHERE COALESCE(${col},'') <> '' GROUP BY 1 ORDER BY 1`)
    console.log(`\n== ${table}.${col} ==`)
    for (const r of rows) console.log(`  ${r.v}  (${r.n})`)
  } catch (e) {
    console.log(`${table}.${col}: ERROR ${e.message}`)
  }
}

// Exhibition categories live in their own table
try {
  const rows = await q(`SELECT name, COUNT(*)::int AS n FROM exhibition_categories GROUP BY 1 ORDER BY 1`)
  console.log('\n== exhibition_categories.name ==')
  for (const r of rows) console.log(`  ${r.name}  (${r.n})`)
} catch (e) {
  console.log(`exhibition_categories: (${e.message})`)
}

await c.end()
console.log('\nDONE (read-only)')
