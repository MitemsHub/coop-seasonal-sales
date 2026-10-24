// READ-ONLY — compute R16141's shopping limit under the retiree rule:
//   cap = (savings − outstanding loans incl. cross-module exposure)
//         + grace (non-eligible) pool, minus loan usage this cycle.
// Also prints the CURRENT rule (savings × 5) for comparison.
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

const MEMBER = process.argv[2] || 'R16141'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const m = await c.query(`
  SELECT member_id, full_name, savings, loans, global_limit, category, portal_enabled
  FROM members WHERE upper(member_id) = $1`, [MEMBER.toUpperCase()])
console.log('\n== member ==')
console.table(m.rows)

const cyc = await c.query(`
  SELECT id, code, food_loan_interest_rate_pct,
         food_loan_eligible_amount_cap, food_loan_grace_amount_cap,
         food_loan_eligible_amount_cap_pensioner, food_loan_eligible_amount_cap_retiree, food_loan_eligible_amount_cap_active,
         food_loan_grace_amount_cap_pensioner, food_loan_grace_amount_cap_retiree, food_loan_grace_amount_cap_active
  FROM cycles WHERE is_active = TRUE ORDER BY id DESC LIMIT 1`)
console.log('\n== active cycle policy ==')
console.table(cyc.rows)
const cycleId = cyc.rows[0]?.id ?? null
const catLower = String(m.rows[0]?.category || '').toLowerCase();
const group = catLower.startsWith('p') || catLower.includes('pension') ? 'pensioner'
  : catLower.startsWith('r') || catLower.includes('retire') ? 'retiree' : 'active'
console.log('member group (per new rule):', group)

if (cycleId) {
  const used = await c.query(`
    SELECT order_id, status, payment_option, total_amount, created_at
    FROM orders
    WHERE upper(member_id) = $1 AND cycle_id = $2
      AND status IN ('Pending','Posted','Delivered')
    ORDER BY created_at DESC`, [MEMBER.toUpperCase(), cycleId])
  console.log('\n== this-cycle orders (Pending/Posted/Delivered) ==')
  console.table(used.rows)

  const yearStart = `${new Date().getFullYear()}-01-01`
  const exposure = await c.query(`
    SELECT payment_option, sum(total_amount) AS amount, count(*) AS n
    FROM orders
    WHERE upper(member_id) = $1 AND status IN ('Pending','Posted','Delivered') AND created_at >= $2
    GROUP BY payment_option`, [MEMBER.toUpperCase(), yearStart])
  console.log('\n== food orders exposure this year ==')
  console.table(exposure.rows)

  const exh = await c.query(`
    SELECT payment_option, sum(total_amount) AS amount, count(*) AS n
    FROM exhibition_orders
    WHERE upper(member_id) = $1 AND status IN ('Pending','Approved','Delivered') AND created_at >= $2
    GROUP BY payment_option`, [MEMBER.toUpperCase(), yearStart])
  console.log('\n== exhibition orders exposure this year ==')
  console.table(exh.rows)
}

await c.end()
console.log(`DONE (read-only, member ${MEMBER})`)
