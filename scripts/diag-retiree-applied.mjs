// READ-ONLY — RETIREE APPLIED REPORT (new savings-based rule)
//
// For every Retiree (category 'R') who has a Pending/Posted/Delivered Loan
// order in the ACTIVE food cycle, compute what they can still borrow:
//
//   cap       = savings − outstanding loans (members.loans)
//               − cross-module loan exposure this year (exhibition)
//   remaining = max(0, cap − cycleLoanUsed)
//
//   cycleLoanUsed = sum of their Pending/Posted/Delivered Loan orders in the
//                   active cycle (current shopping exposure)
//
// Over-cap pending orders are flagged for review. Also prints each retiree's
// OLD-rule eligibility (savings × 5) for comparison.
//
// Usage: node scripts/diag-retiree-applied.mjs [statusFilter=pending|all]
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^[\"']|[\"']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const ONLY_PENDING = (process.argv[2] || 'pending').toLowerCase() !== 'all'
const yearStart = `${new Date().getFullYear()}-01-01`

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

// Active cycle + policy
const cyc = await c.query(`
  SELECT id, code, is_active,
         food_loan_interest_rate_pct,
         food_loan_eligible_amount_cap_retiree  AS eligible_retiree_cap,
         food_loan_grace_amount_cap_retiree     AS grace_retiree_cap,
         food_loan_cap_include_interest
  FROM cycles WHERE is_active = TRUE ORDER BY id DESC LIMIT 1`)
if (!cyc.rows.length) { console.error('No active cycle'); process.exit(1) }
const cycle = cyc.rows[0]
console.log(`Active cycle #${cycle.id} ${cycle.code} · interest ${cycle.food_loan_interest_rate_pct}% · retiree eligible field = ${cycle.eligible_retiree_cap} (ceiling) · retiree grace = ${cycle.grace_retiree_cap}\n`)

// Retirees with applicable Loan orders this cycle
const FILTER = ONLY_PENDING ? `AND o.status = 'Pending'` : `AND o.status IN ('Pending','Posted','Delivered')`
const rows = await c.query(
  `
  SELECT m.member_id, m.full_name, m.savings, m.loans,
         COALESCE(agg.cycle_used, 0)     AS cycle_used,
         COALESCE(agg.pending_amount, 0) AS pending_amount,
         agg.order_count,
         COALESCE(exh.exh_loan, 0)       AS exh_loan_exposure
  FROM (
    SELECT DISTINCT ON (o.member_id) o.member_id
    FROM orders o
    JOIN members m ON upper(m.member_id) = upper(o.member_id)
    WHERE o.cycle_id = $1 AND o.payment_option = 'Loan' ${'  '}${FILTER.replace('AND o', 'AND o')}
      AND upper(m.category) = 'R'
  ) d
  JOIN members m ON upper(m.member_id) = upper(d.member_id)
  LEFT JOIN (
    SELECT upper(member_id) AS member_id,
           SUM(total_amount) FILTER (WHERE status IN ('Pending','Posted','Delivered')) AS cycle_used,
           SUM(total_amount) FILTER (WHERE status = 'Pending')                          AS pending_amount,
           COUNT(*) FILTER (WHERE status IN ('Pending','Posted','Delivered'))           AS order_count
    FROM orders
    WHERE cycle_id = $1 AND payment_option = 'Loan'
    GROUP BY upper(member_id)
  ) agg ON agg.member_id = upper(d.member_id)
  LEFT JOIN (
    SELECT upper(member_id) AS member_id, SUM(total_amount) AS exh_loan
    FROM exhibition_orders
    WHERE status IN ('Pending','Approved','Delivered')
      AND payment_option = 'Loan'
      AND created_at >= $2
    GROUP BY upper(member_id)
  ) exh ON exh.member_id = upper(d.member_id)
  ORDER BY COALESCE(agg.pending_amount, 0) DESC
  `,
  [cycle.id, yearStart]
)

if (!rows.rows.length) {
  console.log('No retirees with applied Loan orders this cycle (under the selected filter).')
} else {
  const fmt = (v) => Number(v || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 })
  const out = rows.rows.map((r) => {
    const savings = Number(r.savings || 0)
    const loans = Number(r.loans || 0)
    const exhExposure = Number(r.exh_loan_exposure || 0)
    const cycleUsed = Number(r.cycle_used || 0)
    const pending = Number(r.pending_amount || 0)
    const cap = Math.max(0, savings - loans - exhExposure)   // savings-based retiree rule (+0 grace)
    const remaining = Math.max(0, cap - cycleUsed)
    const oldCap = Math.max(0, savings * 5 - loans)
    return {
      MEMBER: r.member_id,
      NAME: (r.full_name || '').trim(),
      SAVINGS: fmt(savings),
      LOANS_OUTSTANDING: fmt(loans),
      EXH_EXPOSURE: fmt(exhExposure),
      CAP_NEW: fmt(cap),
      USED_THIS_CYCLE: fmt(cycleUsed),
      CAN_STILL_GET: fmt(remaining),
      OVER_BY: pending > cap ? fmt(pending - cap) : '0',
      OLD_RULE_CAP_5X: fmt(oldCap),
      PENDING_COUNT: Number(r.order_count || 0),
    }
  })
  console.table(out)
  const totalStill = out.reduce((s, row) => s + Number(String(row.CAN_STILL_GET).replace(/,/g, '') || 0), 0)
  console.log(`Retirees listed: ${out.length} · combined "can still get" value: ₦${fmt(totalStill)}`)
}

await c.end()
console.log('\nDONE (read-only)')
