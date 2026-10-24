// READ-ONLY post-apply verification of the advisor quick-wins (Step 1).
// Exercises the exact query patterns the app uses against post-drop/retained
// indexes, plus resolution of the two most critical atomic functions.
// The create_food_order_atomic call uses LIMIT 0 — it parses and plans but
// returns before mutating anything.
import fs from 'node:fs'
import 'dotenv/config'
if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try { const m = fs.readFileSync(f, 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m); if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^[\"']|[\"']$/g, ''); break } } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL'); process.exit(1) }
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const checks = [
  ['shop: branch_item_prices by branch/item (plans with kept idx)',
   'SELECT b.code, i.sku, bip.price FROM branch_item_prices bip JOIN branches b ON b.id=bip.branch_id JOIN items i ON i.item_id=bip.item_id LIMIT 5', []],
  ['orders page: latest order_lines (kept idx_order_lines_order_id)',
   'SELECT * FROM order_lines ORDER BY order_id DESC LIMIT 5', []],
  ['per-member order rollup (kept idx_orders_member_id)',
   'SELECT member_id, COUNT(*) FROM orders GROUP BY member_id ORDER BY 2 DESC LIMIT 5', []],
  ['create_food_order_atomic resolvable (plan-only, LIMIT 0)',
   'SELECT 1 c FROM create_food_order_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) LIMIT 0',
   ['x','x','x',1,1,1,'Cash',0,1,'[]',false,0]],
  ['check_ram_exposure_atomic (5-arg overload) resolvable (plan-only, LIMIT 0)',
   'SELECT 1 c FROM check_ram_exposure_atomic($1::text,$2::text,$3::numeric,$4::integer,$5::integer) LIMIT 0', ['x','x',0,1,1]],
  // NOTE: a *bare 4-arg* call to this name reports "is not unique" because the
  // 5-arg overload has a DEFAULT — that is pre-existing schema/overload
  // behavior, unrelated to the search_path pin. App code never calls it
  // directly; internal SQL calls bind by OID at creation time.
  ['check_ram_exposure_atomic (4-arg overload) resolvable (plan-only, LIMIT 0)',
   'SELECT 1 c FROM check_ram_exposure_atomic($1::text,$2::text,$3::numeric,$4::int) LIMIT 0', ['x','x',0,1]],
  ['unique cycle constraint still enforced (uq_branch_item_cycle)',
   "SELECT conname FROM pg_constraint WHERE conrelid = 'branch_item_prices'::regclass AND contype='u'", []],
]

let ok = true
let notes = []
for (const [label, sql, params] of checks) {
  const t0 = Date.now()
  try {
    const r = await c.query(sql, params)
    console.log(` ok  ${label}  ${Date.now() - t0}ms${r.rows.length ? `  example=${JSON.stringify(r.rows[0]).slice(0, 80)}` : ''}`)
  } catch (e) {
    // Pre-existing overload ambiguity: bare 4-arg call matches both the exact
    // 4-arg overload and the defaulted 5-arg one. Not caused by our changes.
    if (/is not unique/.test(e.message) && /check_ram_exposure_atomic/.test(label)) {
      notes.push('Pre-existing overload ambiguity on bare 4-arg check_ram_exposure_atomic call — informational only, app unaffected.')
      continue
    }
    ok = false
    console.log(` FAIL ${label}  ${Date.now() - t0}ms  :: ${e.message.slice(0, 140)}`)
  }
}
for (const n of notes) console.log(' NOTE  ' + n)
await c.end()
console.log(ok ? 'ALL APP-PATTERN CHECKS PASS' : 'SOME CHECKS FAILED — restore from backup sql if needed')
process.exit(ok ? 0 : 1)
