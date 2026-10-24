// READ-ONLY — convert R16141's live member fields into the exact elig payload
// shapes that /api/members/eligibility and /api/orders/route.js now return
// with the retiree rule, so her numbers can be shown without running a dev
// server.
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

const { rows: [m] } = await c.query(`
  SELECT member_id, savings, loans, global_limit, category FROM members WHERE upper(member_id) = $1`, [MEMBER.toUpperCase()])

const { rows: [cx] } = await c.query(`
  SELECT
    COALESCE(SUM(CASE WHEN payment_option = 'Loan' THEN total_amount ELSE 0 END),0) AS loan,
    COALESCE(SUM(CASE WHEN payment_option = 'Savings' THEN total_amount ELSE 0 END),0) AS savings
  FROM (
    SELECT total_amount, payment_option::text FROM orders
      WHERE upper(member_id) = $1 AND status IN ('Pending','Posted','Delivered') AND created_at >= date_trunc('year', now())
    UNION ALL
    SELECT total_amount, payment_option::text FROM exhibition_orders
      WHERE upper(member_id) = $1 AND status IN ('Pending','Approved','Delivered') AND created_at >= date_trunc('year', now())
  ) x`, [MEMBER.toUpperCase()])

const savings = Number(m.savings), loans = Number(m.loans), globalLimit = Number(m.global_limit)
const loanExposure = Number(cx.loan), savingsExposure = Number(cx.savings)
const outstanding = loans + loanExposure
const isRetiree = ['p', 'r'].includes(String(m.category || '').toLowerCase()[0])
const savingsEligible = outstanding > 0 ? 0 : Math.max(0, savings * 0.5 - savingsExposure)
const rawLoanLimit = isRetiree ? savings - outstanding : savings * 5 - outstanding
const effectiveLimit = globalLimit > 0 ? Math.min(rawLoanLimit, globalLimit) : rawLoanLimit
const loanEligible = Math.max(0, effectiveLimit)

await c.end()

console.log(JSON.stringify({ member: m.member_id, category: m.category, isRetiree, savings, loans, loanExposure, savingsExposure, outstanding, savingsEligible, loanEligible }, null, 2))
console.log('DONE (read-only)')
