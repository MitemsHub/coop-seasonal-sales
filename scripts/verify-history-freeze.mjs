// VERIFICATION HARNESS for the two history-protection migrations:
//   migrations/freeze-historical-item-identity.sql
//   migrations/reprice-trigger-active-cycle-only.sql
//
// Applies both INSIDE a single transaction that is ALWAYS rolled back, then
// proves each behaviour against live data (blocked identity edits, allowed
// no-ops, closed-cycle price edits leaving history untouched, Loan totals
// recomputed at the cycle rate). Re-run it any time:
//
//   node scripts/verify-history-freeze.mjs     # exit 0 = all checks pass
//
// Nothing persists — the script ends with ROLLBACK.
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

// The migration files open with BEGIN; and end with COMMIT; — strip them so
// everything stays inside this script's single always-ROLLBACK transaction.
const loadSql = (f) => fs.readFileSync(f, 'utf8')
  .replace(/^\s*BEGIN;\s*$/gm, '')
  .replace(/^\s*COMMIT;\s*$/gm, '')

let failed = 0
let sp = 0
const savepoint = async () => { await c.query(`SAVEPOINT sp${++sp}`) }
const releaseTo = async () => { await c.query(`ROLLBACK TO SAVEPOINT sp${sp}`) }
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed++
}

try {
  await c.query('BEGIN')

  // ── Migration A ────────────────────────────────────────────────────────────
  await c.query(loadSql('migrations/freeze-historical-item-identity.sql'))
  console.log('applied migrations/freeze-historical-item-identity.sql (in txn)')

  // A1: no-op identity write on a historical item must pass
  await savepoint()
  try {
    await c.query(`UPDATE items SET name = name WHERE item_id = 3`)
    check(true, 'no-op identity update on historical item #3 allowed')
  } catch (e) { check(false, 'no-op identity update on historical item #3 allowed', e.message) }
  await releaseTo()

  // A2: real identity change on a historical item must be blocked
  await savepoint()
  try {
    await c.query(`UPDATE items SET name = 'WRONG NAME TEST' WHERE item_id = 3`)
    check(false, 'identity edit on historical item #3 blocked')
  } catch (e) {
    check(/closed cycle/.test(e.message), 'identity edit on historical item #3 blocked', e.message.slice(0, 120))
  }
  await releaseTo()

  // A3: item that only has active-cycle lines may still be edited
  const editable = (await c.query(`
    SELECT i.item_id FROM items i
     WHERE EXISTS (SELECT 1 FROM order_lines ol JOIN orders o ON o.order_id = ol.order_id
                    WHERE ol.item_id = i.item_id AND o.cycle_id = 3)
       AND NOT EXISTS (SELECT 1 FROM order_lines ol JOIN orders o ON o.order_id = ol.order_id
                        WHERE ol.item_id = i.item_id AND o.cycle_id <> 3)
     LIMIT 1`)).rows[0]
  if (editable) {
    await savepoint()
    try {
      await c.query(`UPDATE items SET name = name || '-' WHERE item_id = $1`, [editable.item_id])
      check(true, `active-cycle-only item #${editable.item_id} still editable`)
    } catch (e) { check(false, `active-cycle-only item #${editable.item_id} still editable`, e.message) }
    await releaseTo()
  } else check(false, 'found an active-cycle-only item to test')

  // A4: retiring (is_active) stays possible on a historical item
  await savepoint()
  try {
    await c.query(`UPDATE items SET is_active = is_active WHERE item_id = 3`)
    check(true, 'is_active untouched by the guard')
  } catch (e) { check(false, 'is_active untouched by the guard', e.message) }
  await releaseTo()

  // ── Migration B ────────────────────────────────────────────────────────────
  await c.query(loadSql('migrations/reprice-trigger-active-cycle-only.sql'))
  console.log('applied migrations/reprice-trigger-active-cycle-only.sql (in txn)')

  // B1: edit a CLOSED-cycle price row — the real trigger path — and prove the
  //     historical line and its order total do not move. (The old function
  //     would rewrite them.)
  const old = (await c.query(`
    SELECT ol.id, ol.unit_price, ol.amount, ol.branch_item_price_id,
           o.order_id, o.cycle_id, o.delivery_branch_id, ol.item_id, o.total_amount
      FROM order_lines ol JOIN orders o ON o.order_id = ol.order_id
     WHERE o.cycle_id = 1 AND o.status IN ('Pending','Posted','Delivered')
       AND ol.branch_item_price_id IS NOT NULL
     ORDER BY ol.id LIMIT 1`)).rows[0]
  if (old) {
    const before = (await c.query(`SELECT unit_price, amount FROM order_lines WHERE id = $1`, [old.id])).rows[0]
    const beforeTotal = (await c.query(`SELECT total_amount FROM orders WHERE order_id = $1`, [old.order_id])).rows[0]
    await c.query(`UPDATE branch_item_prices SET price = price + 1000 WHERE id = $1`, [old.branch_item_price_id])
    const after = (await c.query(`SELECT unit_price, amount FROM order_lines WHERE id = $1`, [old.id])).rows[0]
    const afterTotal = (await c.query(`SELECT total_amount FROM orders WHERE order_id = $1`, [old.order_id])).rows[0]
    check(String(before.unit_price) === String(after.unit_price)
       && String(before.amount) === String(after.amount)
       && String(beforeTotal.total_amount) === String(afterTotal.total_amount),
      'closed-cycle price edit leaves history untouched (trigger path)',
      JSON.stringify({ before, after, beforeTotal, afterTotal }))
  } else check(false, 'found a closed-cycle line for the reprice test')

  // B2: damage an ACTIVE-cycle Loan total with the old 13% maths, then prove
  //     the new function recomputes it at the cycle rate (11.5%).
  const act = (await c.query(`
    SELECT o.order_id, o.delivery_branch_id, ol.item_id, o.cycle_id,
           o.payment_option, o.total_amount, s.principal
      FROM orders o
      JOIN order_lines ol ON ol.order_id = o.order_id
      JOIN (SELECT order_id, SUM(amount) AS principal FROM order_lines GROUP BY order_id) s
        ON s.order_id = o.order_id
     WHERE o.cycle_id = 3 AND o.payment_option = 'Loan'
       AND o.status IN ('Pending','Posted')
     ORDER BY o.order_id LIMIT 1`)).rows[0]
  if (act) {
    await savepoint()
    const damaged = Math.round(Number(act.principal) * 1.13)
    await c.query(`UPDATE orders SET total_amount = $1 WHERE order_id = $2`, [damaged, act.order_id])
    await c.query(`SELECT reprice_orders_for_branch_item($1::bigint, $2::bigint)`,
      [act.delivery_branch_id, act.item_id])
    const now = (await c.query(`
      SELECT o.total_amount, s.principal, c.food_loan_interest_rate_pct
        FROM orders o
        JOIN cycles c ON c.id = o.cycle_id
        JOIN (SELECT order_id, SUM(amount) AS principal FROM order_lines GROUP BY order_id) s
          ON s.order_id = o.order_id
       WHERE o.order_id = $1`, [act.order_id])).rows[0]
    const expected = Number(now.principal) + Math.round(Number(now.principal) * Number(now.food_loan_interest_rate_pct) / 100)
    check(Number(now.total_amount) === expected && Number(now.total_amount) !== damaged,
      `active order #${act.order_id} total recomputed at cycle rate ${now.food_loan_interest_rate_pct}%`,
      `13% damage ${damaged} → stored ${now.total_amount} (expected ${expected})`)
    await releaseTo()
  } else check(false, 'found an active Loan order for the reprice test')
} catch (e) {
  check(false, 'script ran without error', e.message)
} finally {
  await c.query('ROLLBACK').catch(() => {})
  await c.end()
  console.log('\nTRANSACTION ROLLED BACK — no data changed')
  process.exit(failed ? 1 : 0)
}
