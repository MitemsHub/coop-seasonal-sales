// APPLY — add password_hash/password_set_at to members (additive DDL), then
// verify the columns exist.
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

const sql = fs.readFileSync('migrations/add-member-local-password.sql', 'utf8')
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
await c.query(sql)
console.log('APPLIED add-member-local-password.sql')
const cols = await c.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='members' AND column_name IN ('password_hash','password_set_at')
  ORDER BY column_name`)
console.table(cols.rows)
await c.end()
