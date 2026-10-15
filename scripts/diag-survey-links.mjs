// Read-only diagnostic: which survey entries link to the affected outsourced items?
// Prints: outsourced items (with source column state), every candidate
// food_survey_entries row (name match OR saved_item_id link), and the entries
// subquery the GET uses. No writes anywhere — SELECTs only.
import 'dotenv/config'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const { default: fs } = await import('node:fs')
      const txt = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('No SUPABASE_DB_URL found (.env.local / .env.local.remote)')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const q = async (sql, params = []) => (await client.query(sql, params)).rows

// 1. Does the link column even exist?
const col = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='food_survey_entries' ORDER BY ordinal_position`)
console.log('food_survey_entries columns:', col.map(c => c.column_name).join(', '))

// 2. Recent outsourced items + their cycle prices (the ones the admin worked on)
const items = await q(`
  SELECT i.item_id, i.sku, i.name, i.source,
    (SELECT COUNT(*) FROM branch_item_prices p WHERE p.item_id = i.item_id AND p.price > 0) AS priced_branches,
    (SELECT string_agg(DISTINCT b.name, ', ') FROM branch_item_prices p JOIN branches b ON b.id = p.branch_id WHERE p.item_id = i.item_id AND p.price > 0) AS branches
  FROM items i
  WHERE i.source = 'outsourced'
  ORDER BY i.item_id DESC LIMIT 20`)
console.log('\nOutsourced items (latest 20):')
for (const it of items) console.log(` - #${it.item_id} [${it.name}] sku=${it.sku} priced@ ${it.branches || '—'} (${it.priced_branches})`)

// 3. Entries: link state per entry for the current-looking data
const entries = await q(`
  SELECT e.id, e.item_name, e.price, e.saved_item_id,
         s.branch_id, b.name AS branch_name, s.cycle_id, s.rep_name, s.created_at
  FROM food_survey_entries e
  LEFT JOIN food_survey_submissions s ON s.id = e.submission_id
  LEFT JOIN branches b ON b.id = s.branch_id
  WHERE e.saved_item_id IS NOT NULL
     OR e.item_name ILIKE '%coco%'
     OR e.item_name ILIKE '%nasco%'
     OR e.item_name ILIKE '%indomitab%'
  ORDER BY e.id DESC LIMIT 40`)
console.log('\nEntries (linked OR matching the affected products):')
for (const e of entries) {
  console.log(` - entry #${e.id} [${e.item_name}] price=${e.price} saved_item_id=${e.saved_item_id ?? 'NULL'} branch=${e.branch_name || (e.branch_id ?? 'null')} cycle=${e.cycle_id} rep=${e.rep_name} at=${e.created_at?.toISOString?.() || e.created_at}`)
}

// 4. Entries for the matched items where the NAME no longer matches (renamed items)
const renamed = await q(`
  SELECT e.id, e.item_name, e.price, e.saved_item_id, b.name AS branch_name
  FROM food_survey_entries e
  JOIN food_survey_submissions s ON s.id = e.submission_id
  LEFT JOIN branches b ON b.id = s.branch_id
  WHERE e.saved_item_id IS NOT NULL
  ORDER BY e.id DESC LIMIT 30`)
console.log('\nAll currently-linked entries (latest 30):')
for (const e of renamed) {
  console.log(` - entry #${e.id} [${e.item_name}] price=${e.price} -> item #${e.saved_item_id} @ ${e.branch_name || (e.branch_id ?? 'null')}`)
}

await client.end()
