// READ-ONLY — member category census and P-prefixed auth coverage.
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

const cats = await c.query(`SELECT category, count(*) AS total,
  count(*) FILTER (WHERE email IS NULL OR email = '') AS no_email,
  count(*) FILTER (WHERE auth_user_id IS NULL) AS no_auth_user,
  count(*) FILTER (WHERE portal_enabled = true) AS enabled
  FROM members GROUP BY category ORDER BY category`)
console.log('== categories ==')
console.table(cats.rows)

const p = await c.query(`SELECT count(*) AS p_total,
  count(*) FILTER (WHERE email IS NULL OR email = '') AS p_no_email,
  count(*) FILTER (WHERE portal_enabled = true) AS p_enabled
  FROM members WHERE upper(left(member_id,1)) = 'P'`)
console.log('== P-prefixed ==')
console.table(p.rows)

const r = await c.query(`SELECT count(*) AS r_total,
  count(*) FILTER (WHERE email IS NULL OR email = '') AS r_no_email
  FROM members WHERE upper(left(member_id,1)) = 'R'`)
console.log('== R-prefixed ==')
console.table(r.rows)

await c.end()
console.log('DONE (read-only)')
