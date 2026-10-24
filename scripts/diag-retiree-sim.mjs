// READ-ONLY — simulate the patched create_food_order_atomic math for a member
// (no orders created). Mirrors: retiree rule, cross-module exposure, cycle cap.
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

const one = await c.query(`
  WITH member AS (
    SELECT member_id, category, COALESCE(savings,0) AS savings, COALESCE(loans,0) AS loans, COALESCE(global_limit,0) AS global_limit
    FROM members WHERE upper(member_id) = $1
  ), exposure AS (
    SELECT
      COALESCE(SUM(CASE WHEN payment_option = 'Loan' THEN total_amount ELSE 0 END),0) AS loan_exposure,
      COALESCE(SUM(CASE WHEN payment_option = 'Savings' THEN total_amount ELSE 0 END),0) AS savings_exposure
    FROM (
      SELECT total_amount, payment_option::text FROM orders
        WHERE upper(member_id) = $1 AND status IN ('Pending','Posted','Delivered') AND created_at >= date_trunc('year', now())
      UNION ALL
      SELECT total_amount, payment_option::text FROM exhibition_orders
        WHERE upper(member_id) = $1 AND status IN ('Pending','Approved','Delivered') AND created_at >= date_trunc('year', now())
    ) x
  ), cycle AS (
    SELECT c.id AS cycle_id,
      GREATEST(0, TRUNC(COALESCE(c.food_loan_eligible_amount_cap_retiree,0))) AS retiree_loan_cap,
      GREATEST(0, TRUNC(COALESCE(c.food_loan_grace_amount_cap_retiree,0))) AS retiree_grace_cap
    FROM cycles c WHERE c.is_active = TRUE ORDER BY c.id DESC LIMIT 1
  ), cycle_used AS (
    SELECT COALESCE(SUM(o.total_amount),0) AS total
    FROM orders o, cycle cy
    WHERE upper(o.member_id) = $1 AND o.payment_option = 'Loan' AND o.cycle_id = cy.cycle_id
      AND o.status IN ('Pending','Posted','Delivered')
  )
  SELECT
    m.member_id, m.category, m.savings, m.loans, m.global_limit,
    e.loan_exposure, e.savings_exposure,
    cy.cycle_id, cy.retiree_loan_cap, cy.retiree_grace_cap, cu.total AS cycle_loan_total,
    (m.loans + e.loan_exposure) AS outstanding,
    CASE
      WHEN LEFT(LOWER(m.category),1) = 'r' THEN GREATEST(0, (m.savings) - (m.loans + e.loan_exposure))
      ELSE GREATEST(0, (m.savings * 5) - (m.loans + e.loan_exposure))
    END AS raw_loan_limit,
    LEAST(
      CASE
        WHEN LEFT(LOWER(m.category),1) = 'r' THEN GREATEST(0, (m.savings) - (m.loans + e.loan_exposure))
        ELSE GREATEST(0, (m.savings * 5) - (m.loans + e.loan_exposure))
      END,
      GREATEST(0, cy.retiree_loan_cap - cu.total)
    ) AS loan_eligible_now
  FROM member m CROSS JOIN exposure e CROSS JOIN cycle cy CROSS JOIN cycle_used cu
`, [MEMBER.toUpperCase()])

console.table(one.rows)
await c.end()
console.log('DONE (read-only simulation)')
