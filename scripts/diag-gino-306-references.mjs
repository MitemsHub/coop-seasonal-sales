// READ-ONLY — who references item #306 (Gino Party Jollof) + legacy Gino alcohol rows?
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

const jollof = await q(`SELECT item_id, sku, name, is_active, source, image_url FROM items WHERE sku ILIKE '%JOLLOF%' ORDER BY item_id`)
for (const it of jollof) {
  console.log(`item #${it.item_id} [${it.name}] sku=${it.sku} active=${it.is_active} source=${it.source} image=${(it.image_url || '(none)').slice(0, 120)}`)
  const prices = await q(`SELECT b.name, b.code, p.cycle_id, p.price FROM branch_item_prices p JOIN branches b ON b.id = p.branch_id WHERE p.item_id = $1 ORDER BY b.name`, [it.item_id])
  for (const p of prices) console.log(`   price: ${p.name} (${p.code}) cycle=${p.cycle_id}  ₦${p.price}`)
  const entries = await q(`
    SELECT e.id, e.item_name, e.cancelled, b.name AS branch, s.cycle_id, s.created_at
    FROM food_survey_entries e JOIN food_survey_submissions s ON s.id = e.submission_id JOIN branches b ON b.id = s.branch_id
    WHERE e.saved_item_id = $1 ORDER BY s.created_at DESC`, [it.item_id])
  for (const e of entries) console.log(`   entry #${e.id} [${e.item_name}] ${e.branch} cycle=${e.cycle_id} cancelled=${e.cancelled}`)
  await c.end ? null : null
}
await c.end()
console.log('DONE')
