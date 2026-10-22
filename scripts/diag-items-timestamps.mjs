// READ-ONLY — items table columns + xmin for items 14/306 + survey object timestamps
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { const t = fs.readFileSync(f, 'utf8'); const m = t.match(/^SUPABASE_DB_URL=(.*)$/m); if (m && !process.env.SUPABASE_DB_URL) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break } } catch {}
}
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='items' AND table_schema='public' ORDER BY ordinal_position`)
const colNames = cols.rows.map(r => r.column_name)
console.log('items columns:', colNames.join(', '))
const tsCols = ['created_at', 'updated_at'].filter(cn => colNames.includes(cn))
const rows = await c.query(`SELECT item_id, sku, xmin::text AS xmin_id, ${tsCols.map(cn => cn + '::text').join(', ') || "NULL::text AS created_at"} FROM items WHERE item_id IN (14, 306)`)
for (const r of rows.rows) console.log('item', r.item_id, r.sku, 'xmin liked id =', r.xmin_id, tsCols.map(cn => `${cn}=${r[cn]}`).join(' '))
const surv = await c.query(`SELECT name, bucket_id, created_at::text AS created, updated_at::text AS updated FROM storage.objects WHERE bucket_id='food-survey' AND name LIKE '%1792485451803%'`)
for (const s of surv.rows) console.log('survey object:', s.bucket_id + '/' + s.name, 'created', s.created, 'updated', s.updated)
await c.end()
