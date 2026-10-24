// READ-ONLY — audit Pending food orders of the active cycle against the
// CURRENT rules (post-patch). For each pending order, computes what the
// member's loanEligible / savingsEligible WERE at purchase time, excluding
// the order itself from exposure, and flags orders that exceed it — i.e.
// orders that should not have been possible under today's rules.
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

// Active cycle policy
const { rows: [cyc] } = await c.query(`
  SELECT id, code, food_loan_interest_rate_pct, food_loan_cap_include_interest,
         food_loan_eligible_amount_cap, food_loan_grace_amount_cap,
         food_loan_eligible_amount_cap_pensioner, food_loan_eligible_amount_cap_retiree,
         food_loan_eligible_amount_cap_active,
         food_loan_grace_amount_cap_pensioner, food_loan_grace_amount_cap_retiree, food_loan_grace_amount_cap_active
  FROM cycles WHERE is_active = TRUE ORDER BY id DESC LIMIT 1`)
if (!cyc) { console.log('No active cycle'); process.exit(0) }
const includeInterest = cyc.food_loan_cap_include_interest !== false
const rate = Number(cyc.food_loan_interest_rate_pct) || 0

// Pending orders + member fields
const orders = (await c.query(`
  SELECT o.order_id, o.member_id, o.member_category_snapshot, o.payment_option,
         o.total_amount, o.created_at, o.cycle_id,
         m.savings, m.loans, m.global_limit, m.category AS member_category
  FROM orders o
  LEFT JOIN members m ON upper(m.member_id) = upper(o.member_id)
  WHERE o.cycle_id = $1 AND o.status = 'Pending'
  ORDER BY o.created_at DESC`, [cyc.id])).rows

// All non-cancelled orders this calendar year for exposure (Loan to be
// subtracted per-order when evaluating itself)
const exposure = (await c.query(`
  SELECT upper(member_id) AS mid, payment_option::text AS opt,
         SUM(total_amount) AS amt, MAX(CASE WHEN order_id IS NOT NULL THEN order_id END) AS dummy
  FROM (
    SELECT member_id, payment_option::text, total_amount, order_id::text FROM orders
      WHERE status IN ('Pending','Posted','Delivered') AND created_at >= date_trunc('year', now())
    UNION ALL
    SELECT member_id, payment_option::text, total_amount, NULL FROM exhibition_orders
      WHERE status IN ('Pending','Approved','Delivered') AND created_at >= date_trunc('year', now())
  ) x GROUP BY upper(member_id), payment_option::text`)).rows

// Current-cycle loan usage per member (excl the order itself handled in JS)
const cycleUse = (await c.query(`
  SELECT upper(member_id) AS mid, SUM(total_amount) AS amt
  FROM orders
  WHERE cycle_id = $1 AND payment_option = 'Loan' AND status IN ('Pending','Posted','Delivered')
  GROUP BY upper(member_id)`, [cyc.id])).rows

const groupOf = (cat) => {
  const k = String(cat || '').toLowerCase()
  if (k.startsWith('p') || k.includes('pension')) return 'pensioner'
  if (k.startsWith('r') || k.includes('retire')) return 'retiree'
  return 'active'
}
const capOf = (p, f) => Math.max(0, Math.trunc(Number(p[f]) || 0))

const helper = new Map()
const exposureFor = (mid) => {
  if (!helper.size) {
    for (const r of exposure) {
      const key = String(r.mid).toUpperCase()
      if (!helper.has(key)) helper.set(key, { loan: 0, savings: 0 })
      const e = helper.get(key)
      if (r.opt === 'Loan') e.loan = Number(r.amt)
      else if (r.opt === 'Savings') e.savings = Number(r.amt)
    }
  }
  return helper.get(String(mid).toUpperCase()) || { loan: 0, savings: 0 }
}
const cycleUseFor = new Map(cycleUse.map(r => [String(r.mid).toUpperCase(), Number(r.amt)]))

// Compute the cap each member had AT PURCHASE TIME (self-order excluded)
const computeAllowed = (o, isLoan) => {
  const e = exposureFor(o.member_id)
  const orderAmt = Number(o.total_amount) || 0
  const outstanding = Number(o.loans) + (Math.max(0, e.loan - orderAmt))
  const savingsExposure = Math.max(0, e.savings - (isLoan ? 0 : orderAmt))
  const savings = Number(o.savings) || 0
  const group = groupOf(o.member_category || o.member_category_snapshot)
  if (!isLoan) {
    // Savings purchase: blocked if loans outstanding, else 50% savings − exposure
    if (outstanding > 0) return { allowed: 0, reason: 'loans outstanding', group }
    return { allowed: Math.max(0, savings * 0.5 - savingsExposure), reason: '', group }
  }
  // Loan purchase: cap-aware amount (interest excluded from cap when OFF)
  const capCompare = includeInterest ? orderAmt : Math.round(orderAmt / (1 + rate / 100))
  const raw = group === 'retiree' ? savings - outstanding : savings * 5 - outstanding
  const g = Number(o.global_limit) || 0
  const base = Math.max(0, g > 0 ? Math.min(raw, g) : raw)
  // Cycle caps per group (with legacy fallback)
  let loanCap = capOf(cyc, `food_loan_eligible_amount_cap_${group}`)
  let graceCap = capOf(cyc, `food_loan_grace_amount_cap_${group}`)
  if (loanCap === 0) loanCap = capOf(cyc, 'food_loan_eligible_amount_cap')
  if (graceCap === 0) graceCap = capOf(cyc, 'food_loan_grace_amount_cap')
  const usedExcl = Math.max(0, (cycleUseFor.get(String(o.member_id).toUpperCase()) || 0) - orderAmt)
  let loanEligible
  if (loanCap > 0) loanEligible = Math.min(base + graceCap, Math.max(0, loanCap - usedExcl))
  else loanEligible = base + graceCap
  // Grace repeat rule: base<=0 ⇒ facility usable once per cycle
  if (base <= 0 && graceCap > 0 && usedExcl > 0) loanEligible = 0
  return { allowed: Math.max(0, loanEligible), capCompare, reason: '', group, base, loanCap, usedExcl }
}

console.log(`Active cycle: ${cyc.code} (id ${cyc.id}) · include-interest-in-cap: ${includeInterest ? 'ON' : 'OFF'} @ ${rate}% · pending orders: ${orders.length}\n`)

const flagged = []
for (const o of orders) {
  const isLoan = o.payment_option === 'Loan'
  const { allowed, capCompare, reason, group, base, loanCap, usedExcl } = computeAllowed(o, isLoan)
  const compare = isLoan ? (capCompare ?? Number(o.total_amount)) : Number(o.total_amount)
  if (compare > allowed + 0.005) {
    flagged.push({ o, allowed, reason, group, compare, base, loanCap, usedExcl, isLoan })
  }
}

if (!flagged.length) {
  console.log('CLEAN: no pending orders exceed today\'s rules.')
} else {
  console.log(`⚠ ${flagged.length} of ${orders.length} pending orders exceed today's rules:\n`)
  for (const f of flagged) {
    const { o } = f
    const why = !f.isLoan
      ? `Savings while loans outstanding (${f.reason}) or over savings eligibility`
      : f.group === 'retiree'
        ? `RETIREE rule: borrowable = savings § base ${f.base} ; total ${f.compare}`
        : `base ${f.base}; cap ${f.loanCap}; cycle-used excl this ${f.usedExcl}`
    console.log([
      `#${o.order_id}`,
      o.member_id,
      `(${(o.member_category || o.member_category_snapshot || '')} → ${f.group})`,
      o.payment_option,
      `order ₦${Number(o.total_amount).toLocaleString()}`,
      `allowed-at-purchase ₦${Number(f.allowed).toLocaleString()}`,
      `over-by ₦${(f.compare - f.allowed).toLocaleString()}`,
      `| ${why}`,
      `| ${new Date(o.created_at).toISOString().slice(0, 16).replace('T', ' ')}`,
    ].join(' '))
  }
}

await c.end()
console.log('\nDONE (read-only)')
