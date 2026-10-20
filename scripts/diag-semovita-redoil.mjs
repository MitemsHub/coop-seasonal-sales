// Read-only diagnostic: Golden Penny Semovita 1Kg × Fresh Red Oil — the
// General×Outsourced cross-link damage reported on 2026-10-20.
// SELECTs only; no writes.
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

const items = await q(`
  SELECT i.item_id, i.sku, i.name, i.source, i.is_active, i.image_url,
    (SELECT COUNT(*) FROM branch_item_prices p WHERE p.item_id = i.item_id AND p.price > 0) AS priced_branches,
    (SELECT string_agg(DISTINCT b.name, ', ') FROM branch_item_prices p JOIN branches b ON b.id = p.branch_id WHERE p.item_id = i.item_id AND p.price > 0) AS branches
  FROM items i
  WHERE i.name ILIKE '%semovita%' OR i.sku ILIKE '%semovita%' OR i.name ILIKE '%red oil%' OR i.sku ILIKE '%redoil%'
  ORDER BY i.item_id`)
console.log('Items matching Semovita / Red Oil:')
for (const it of items) console.log(` - #${it.item_id} [${it.name}] sku=${it.sku} source=${it.source ?? '—'} active=${it.is_active ?? '—'} img=${it.image_url ? 'yes' : 'NO'} priced@ ${it.branches || '—'} (${it.priced_branches})`)

const ids = items.map((i) => i.item_id)
if (ids.length) {
  const idList = ids.join(',')
  const links = await q(`
    SELECT e.id, e.item_name, e.price, e.saved_item_id, e.cancelled,
           s.branch_id, b.name AS branch_name, s.cycle_id, s.rep_name
    FROM food_survey_entries e
    JOIN food_survey_submissions s ON s.id = e.submission_id
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE e.saved_item_id IN (${idList}) OR e.item_name ILIKE '%semovita%' OR e.item_name ILIKE '%red oil%'
    ORDER BY e.id DESC LIMIT 40`)
  console.log('\nLinked/related survey entries:')
  for (const e of links) console.log(` - entry #${e.id} [${e.item_name}] price=${e.price} -> item #${e.saved_item_id ?? 'NULL'} branch=${e.branch_name || e.branch_id} cycle=${e.cycle_id} rep=${e.rep_name} cancelled=${e.cancelled ?? '—'}`)
}

const enugu = await q(`SELECT id, name, code FROM branches WHERE name ILIKE '%enugu%' OR code ILIKE '%enugu%'`)
console.log('\nEnugu branches:', enugu)

const cycles = await q(`SELECT id, is_active FROM cycles ORDER BY id DESC LIMIT 3`)
console.log('Cycles (latest 3):', cycles)

await client.end()
