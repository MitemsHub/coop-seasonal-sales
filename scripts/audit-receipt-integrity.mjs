// Audit: receipt integrity — "does every historical order still show exactly
// what the member bought?"
//
// Run this BEFORE opening a new cycle (and after any item-rename, remap,
// repricing or repair script). Read-only. Exit code 0 = clean, 1 = findings,
// so a cron can alert on non-zero — same contract as
// scripts/audit-outsourced-price-spread.mjs.
//
// What it catches, and why (see migrations/freeze-historical-item-identity.sql
// and migrations/reprice-trigger-active-cycle-only.sql):
//   [1] totals that no longer equal their lines (+ the cycle's loan rate)
//   [2] lines whose price row belongs to another cycle / another item / none
//   [3] the same item on 2+ lines of one order (cart double-add)
//   [4] one order showing the same display name from two different item rows
//   [5] receipts still rendering RETIRED item rows
//   [6] two ACTIVE items sharing a display name (twin rows)
//   [7] absurd price rows in the ACTIVE cycle (>= ₦500,000)
//   [8] items with closed-cycle history (informational: identity is frozen)
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const txt = fs.readFileSync(f, 'utf8')
      const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('No SUPABASE_DB_URL found (.env.local / .env.local.remote)')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows

let findings = 0
const report = (label, rows, limit = 8, level = 'FAIL') => {
  if (!rows.length) { console.log(`  ok   ${label}`); return }
  if (level === 'info') {
    console.log(`  info ${label} — ${rows.length} row(s) (watchlist, not a defect)`)
    for (const r of rows.slice(0, 3)) console.log('         ', JSON.stringify(r))
    if (rows.length > 3) console.log(`          … ${rows.length - 3} more`)
    return
  }
  findings += rows.length
  console.log(`  ${level} ${label} — ${rows.length} row(s)`)
  for (const r of rows.slice(0, limit)) console.log('         ', JSON.stringify(r))
  if (rows.length > limit) console.log(`          … ${rows.length - limit} more`)
}

console.log('receipt integrity audit')

// [1] totals vs lines, split by payment option and cycle
report('non-Loan orders whose total != sum(lines)', await q(`
  SELECT o.order_id, o.cycle_id, o.status, o.total_amount, l.s AS lines_sum
    FROM orders o
    JOIN (SELECT order_id, SUM(amount) AS s FROM order_lines GROUP BY order_id) l
      ON l.order_id = o.order_id
   WHERE o.payment_option <> 'Loan' AND ABS(o.total_amount - l.s) > 0.005`))

report('Loan orders whose interest != cycle rate', await q(`
  SELECT o.order_id, o.cycle_id, o.status, o.total_amount, l.s AS principal,
         ROUND(l.s * COALESCE(c.food_loan_interest_rate_pct, 13) / 100.0) AS expected_interest
    FROM orders o
    JOIN cycles c ON c.id = o.cycle_id
    JOIN (SELECT order_id, SUM(amount) AS s FROM order_lines GROUP BY order_id) l
      ON l.order_id = o.order_id
   WHERE o.payment_option = 'Loan'
     AND ABS(o.total_amount - (l.s + ROUND(l.s * COALESCE(c.food_loan_interest_rate_pct, 13) / 100.0))) > 0.005`))

// [2] price-row integrity
report('lines whose price row is from another cycle / another item / missing', await q(`
  SELECT ol.order_id, o.cycle_id, ol.item_id,
         bip.id AS price_row, bip.cycle_id AS price_cycle, bip.item_id AS price_item
    FROM order_lines ol
    JOIN orders o ON o.order_id = ol.order_id
    LEFT JOIN branch_item_prices bip
           ON bip.id = ol.branch_item_price_id
          AND bip.branch_id = o.delivery_branch_id
          AND bip.cycle_id  = o.cycle_id
          AND bip.item_id   = ol.item_id
   WHERE bip.id IS NULL`))

// [3] duplicate lines of the same item
report('orders with the same item on 2+ lines', await q(`
  SELECT order_id, item_id, COUNT(*)::int AS lines, SUM(qty)::int AS qty, SUM(amount) AS amount
    FROM order_lines GROUP BY order_id, item_id HAVING COUNT(*) > 1 ORDER BY order_id DESC`))

// [4] same display name twice in one order
report('orders showing one name from two item rows', await q(`
  SELECT ol.order_id, i.name, COUNT(DISTINCT ol.item_id)::int AS item_rows
    FROM order_lines ol JOIN items i ON i.item_id = ol.item_id
   GROUP BY ol.order_id, i.name HAVING COUNT(DISTINCT ol.item_id) > 1
   ORDER BY ol.order_id DESC`))

// [5] receipts rendering retired rows — informational: buying a product that
//     was later retired is legitimate, but these names are the ones that
//     migrations/freeze-historical-item-identity.sql now keeps frozen.
report('receipt lines on RETIRED items', await q(`
  SELECT o.cycle_id, ol.order_id, ol.item_id, i.sku, i.name
    FROM order_lines ol
    JOIN items i ON i.item_id = ol.item_id
    JOIN orders o ON o.order_id = ol.order_id
   WHERE i.is_active = FALSE
   ORDER BY o.cycle_id, ol.order_id DESC`), 10, 'info')

// [6] two active items sharing a display name
report('duplicate ACTIVE display names in items', await q(`
  SELECT lower(name) AS name, array_agg(item_id ORDER BY item_id) AS ids,
         array_agg(sku ORDER BY item_id) AS skus
    FROM items WHERE is_active = TRUE
   GROUP BY lower(name) HAVING COUNT(*) > 1`))

// [7] absurd prices in the ACTIVE cycle
report('active-cycle price rows >= 500,000', await q(`
  SELECT p.id, p.branch_id, b.name AS branch, p.item_id, i.name AS item, p.price
    FROM branch_item_prices p
    JOIN branches b ON b.id = p.branch_id
    JOIN items i ON i.item_id = p.item_id
    JOIN cycles c ON c.id = p.cycle_id AND c.is_active = TRUE
   WHERE p.price >= 500000`))

// [8] informational — the set that migrations/freeze-historical-item-identity.sql locks
const frozen = await q(`
  SELECT COUNT(DISTINCT ol.item_id)::int AS items, COUNT(*)::int AS lines
    FROM order_lines ol
    JOIN orders o ON o.order_id = ol.order_id
    JOIN cycles c ON c.id = o.cycle_id
   WHERE COALESCE(c.is_active, FALSE) = FALSE`)
console.log(`  info items with closed-cycle history (identity frozen): ${frozen[0].items} item rows, ${frozen[0].lines} lines`)

await client.end()
console.log(findings ? `\n${findings} finding(s)` : '\nclean')
process.exit(findings ? 1 : 0)
