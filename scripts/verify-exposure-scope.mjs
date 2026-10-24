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
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const oldE = await c.query(
  `SELECT COALESCE(SUM(total_amount),0)::numeric AS v FROM orders
    WHERE member_id=$1 AND status IN ('Pending','Posted','Delivered')
      AND payment_option='Loan' AND created_at >= date_trunc('year', NOW())`, [mid])
const newE = await c.query(
  `SELECT COALESCE(SUM(o.total_amount),0)::numeric AS v, (SELECT id FROM cycles WHERE is_active ORDER BY id DESC LIMIT 1) AS cyc
     FROM orders o
    WHERE o.member_id=$1 AND o.status IN ('Pending','Posted','Delivered')
      AND o.payment_option='Loan'
      AND o.cycle_id = (SELECT id FROM cycles WHERE is_active ORDER BY id DESC LIMIT 1)`, [mid])
console.log(`Member ${mid} loan exposure:`)
console.log('  OLD (calendar year):', oldE.rows[0].v)
console.log('  NEW (active cycle ' + newE.rows[0].cyc + '):', newE.rows[0].v)
await c.end()
