import pg from 'pg'
import fs from 'fs'

let url = process.env.SUPABASE_DB_URL
if (!url) {
  for (const f of ['.env.local', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { url = m[1].trim().replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
const mid = process.argv[2] || 'P03117'
const yStart = new Date(new Date().getFullYear(), 0, 1).toISOString()
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const o = await c.query(
  `SELECT o.order_id, o.cycle_id, o.status, o.payment_option, o.total_amount, o.created_at
     FROM orders o
    WHERE o.member_id = $1 AND o.created_at >= $2
    ORDER BY o.created_at`, [mid, yStart])
console.log(`== Food orders this calendar year for ${mid} ==`)
console.table(o.rows)
const all = await c.query(
  `SELECT order_id, cycle_id, status, payment_option, total_amount, created_at
     FROM orders WHERE member_id = $1 ORDER BY created_at DESC LIMIT 10`, [mid])
console.log('== All Food orders (latest 10) ==')
console.table(all.rows)
await c.end()
