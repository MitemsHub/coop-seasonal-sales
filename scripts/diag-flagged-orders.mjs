// READ-ONLY — profile the five flagged overdue pending orders
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
const { rows } = await c.query(`
  SELECT o.order_id, o.member_id, o.member_name_snapshot, o.total_amount, o.payment_option,
         o.member_category_snapshot, o.created_at,
         o.member_name_snapshot AS member_full_name, m.category, m.savings, m.loans, m.global_limit, b.name AS branch
  FROM orders o
  LEFT JOIN members m ON upper(m.member_id) = upper(o.member_id)
  LEFT JOIN branches b ON b.id = o.branch_id
  WHERE o.cycle_id = 3 AND o.status = 'Pending' AND o.order_id::text = ANY($1)
  ORDER BY o.created_at`, [['1385','1382','1375','1373','1370']])
for (const r of rows) {
  console.log([
    r.order_id, r.member_id,
    (r.member_full_name || ''),
    'branch:' + (r.branch || '?'),
    'savings:' + (r.savings || 0),
    'loans:' + (r.loans || 0),
    'glimit:' + (r.global_limit || 0),
    'order:\u20A6' + r.total_amount,
    r.payment_option,
    'created:' + new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')
  ].join(' | '))
}
await c.end()
