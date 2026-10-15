// Read-only diagnostic: Abeokuta survey entries vs what Items Import dedup keeps.
import 'dotenv/config'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const fs = await import('node:fs')
      const txt = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const rows = (await client.query(`
  SELECT e.id, e.item_name, e.price, e.saved_item_id, s.cycle_id, s.created_at
  FROM food_survey_entries e
  JOIN food_survey_submissions s ON s.id = e.submission_id
  JOIN branches b ON b.id = s.branch_id
  WHERE b.name ILIKE 'Abeokuta%'
    AND e.item_name ILIKE '%rice%'
  ORDER BY e.id ASC`)).rows
console.log('Abeokuta entries with "rice" in the name:')
for (const r of rows) console.log(` #${r.id} [${r.item_name}] price=${r.price} saved_item_id=${r.saved_item_id} cycle=${r.cycle_id}`)

const dupes = (await client.query(`
  SELECT lower(regexp_replace(e.item_name, '\\s+', ' ', 'g')) AS nk, COUNT(*) AS n,
         string_agg(e.id::text, ',' ORDER BY e.id) AS ids, array_agg(e.saved_item_id) AS links
  FROM food_survey_entries e
  JOIN food_survey_submissions s ON s.id = e.submission_id
  WHERE s.cycle_id = 3
  GROUP BY 1 HAVING COUNT(*) > 1
  ORDER BY n DESC, 1`)).rows
console.log('\nAll cycle-3 duplicate (branch-agnostic) draft names:')
for (const d of dupes.slice(0, 25)) console.log(` [${d.nk}] ×${d.n} ids=${d.ids} links=[${d.links.join(',')}]`)

await client.end()
