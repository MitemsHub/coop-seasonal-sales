// REPAIR: restore item #20's cycle-1 identity ("Maggi Chicken Cube") and move
// this year's sales onto a new row that keeps today's catalogue name
// ("Maggi Double Cube"), so no open-cycle receipt changes text.
//
// Evidence that #20 was "Maggi Chicken Cube" in cycle 1:
//   • Finance journal JV/14451 (13.01.2026) for order 1274: "2 Maggi Chicken
//     Cube {2025 SEASONAL S}" — amount 47,046 = 2 x (23,023 + 500), and
//     23,023 is exactly #20's own 2025Q3 price at Coop Secretariat
//     (#21 Maggi Chicken Double was 28,779 there, so the line is #20).
//   • Six audit_log delivery notes of 2025-12-23 name "Maggi Chicken Cube"
//     (ids 828, 829, 831, 835, 836, 837); NO audit note anywhere says
//     "Double Cube".
//   • Rename fingerprint: #20's image is items/MAGGICUBE.png (uploaded
//     2025-10-27, the cycle-1 catalogue build) while its sku is now
//     MAGGIDOUBLECUBE — the sku/name changed, the image file did not.
//
// Same shape as repair-semovita-split.mjs: freeze trigger disabled only inside
// this savepoint for the one corrective rename, re-enabled before COMMIT.
//
// Usage: node scripts/repair-maggi-split.mjs [--dry]

import fs from 'node:fs'
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {}
}
const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run')
console.log(DRY ? 'MODE: DRY-RUN (everything rolled back)\n' : 'MODE: WRITE\n')

const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0]
const many = async (sql, p = []) => (await c.query(sql, p)).rows
const say = (k, v) => console.log(`  ${String(k).padEnd(46)} ${v}`)

try {
  console.log('== preflight ==')
  const i20 = await one(`SELECT * FROM items WHERE item_id=20`)
  const act = await one(`SELECT id FROM cycles WHERE is_active`)
  const closedIds = (await many(`SELECT id FROM cycles WHERE NOT is_active`)).map(r => r.id)
  const st = {
    '#20': `${i20.name} / ${i20.sku} / active=${i20.is_active}`,
    'active cycle': act.id,
    '#20 closed lines': (await one(`SELECT COUNT(*)::int n FROM order_lines ol
      JOIN orders o ON o.order_id=ol.order_id WHERE ol.item_id=20 AND o.cycle_id=ANY($1)`, [closedIds])).n,
    '#20 active lines': (await one(`SELECT COUNT(*)::int n FROM order_lines ol
      JOIN orders o ON o.order_id=ol.order_id WHERE ol.item_id=20 AND o.cycle_id=$1`, [act.id])).n,
    '#20 active price rows': (await one(`SELECT COUNT(*)::int n FROM branch_item_prices
      WHERE item_id=20 AND cycle_id=$1`, [act.id])).n,
    '#20 active markups': (await one(`SELECT COUNT(*)::int n FROM branch_item_markups
      WHERE item_id=20 AND cycle_id=$1`, [act.id])).n,
    '#20 overrides/survey/inventory': `${(await one(`SELECT COUNT(*)::int n FROM item_branch_overrides WHERE item_id=20`)).n}/` +
      `${(await one(`SELECT COUNT(*)::int n FROM food_survey_entries WHERE saved_item_id=20`)).n}/` +
      `${(await one(`SELECT COUNT(*)::int n FROM inventory_movements WHERE item_id=20`)).n}`,
    'sku MAGGIDOUBLECUBE taken by': (await one(`SELECT COUNT(*)::int n FROM items WHERE sku='MAGGIDOUBLECUBE'`)).n,
    'sku free for tombstone': (await one(`SELECT COUNT(*)::int n FROM items WHERE sku='RETIRED-MAGGICHICKENCUBE-2025Q3'`)).n,
    'active lines placed on/after 2026-10-13': (await one(`SELECT COUNT(*)::int n FROM order_lines ol
      JOIN orders o ON o.order_id=ol.order_id WHERE ol.item_id=20 AND o.cycle_id=$1
      AND o.created_at >= '2026-10-13T00:00:00Z'`, [act.id])).n,
    'freeze trigger': JSON.stringify(await many(`SELECT tgname, tgenabled FROM pg_trigger
      WHERE tgrelid='items'::regclass AND NOT tgisinternal`)),
  }
  for (const [k, v] of Object.entries(st)) say(k, v)
  const ok = i20.name === 'Maggi Double Cube' && i20.sku === 'MAGGIDOUBLECUBE' && i20.is_active === true &&
    st['#20 closed lines'] === 276 && st['#20 active lines'] === 118 && st['#20 active price rows'] === 39 &&
    st['#20 active markups'] === 39 && st['#20 overrides/survey/inventory'] === '0/0/0' &&
    st['sku MAGGIDOUBLECUBE taken by'] === 1 && st['sku free for tombstone'] === 0
  if (!ok) throw new Error('preflight mismatch — refusing to run')
  console.log('  preflight: OK\n')

  await c.query('BEGIN')
  const step = async (label, sql, p = []) => {
    const r = await c.query(sql, p)
    say(label, `${r.rowCount} row(s)`)
    return r
  }

  console.log('== apply ==')
  step('#20 sku -> retired tombstone', `UPDATE items SET sku='RETIRED-MAGGICHICKENCUBE-2025Q3'
    WHERE item_id=20 AND sku='MAGGIDOUBLECUBE'`)

  const ins = await c.query(`INSERT INTO items (sku, name, unit, category, is_active, image_url, department_id, source)
    SELECT 'MAGGIDOUBLECUBE', 'Maggi Double Cube', unit, category, TRUE, image_url, department_id, source
      FROM items WHERE item_id = 20 RETURNING item_id`)
  const newId = ins.rows[0].item_id
  say('new active row for this cycle', `item #${newId} Maggi Double Cube / MAGGIDOUBLECUBE`)

  step('active price rows -> new row', `UPDATE branch_item_prices SET item_id=$1
    WHERE item_id=20 AND cycle_id=$2`, [newId, act.id])
  step('active markups -> new row', `UPDATE branch_item_markups SET item_id=$1
    WHERE item_id=20 AND cycle_id=$2`, [newId, act.id])
  step('active order lines -> new row', `UPDATE order_lines ol SET item_id=$1
    FROM orders o WHERE ol.order_id=o.order_id AND ol.item_id=20 AND o.cycle_id=$2`, [newId, act.id])

  await c.query(`SAVEPOINT freeze_bypass`)
  await c.query(`ALTER TABLE items DISABLE TRIGGER trg_protect_historical_item_identity`)
  step('#20 identity -> Maggi Chicken Cube', `UPDATE items
      SET name='Maggi Chicken Cube', is_active=FALSE
    WHERE item_id=20 AND name='Maggi Double Cube'`)
  await c.query(`ALTER TABLE items ENABLE TRIGGER trg_protect_historical_item_identity`)
  await c.query(`RELEASE SAVEPOINT freeze_bypass`)

  console.log('\n== in-transaction verification ==')
  const l = await many(`SELECT ol.id, i.item_id, i.name, ol.qty, ol.unit_price, ol.amount
    FROM order_lines ol JOIN items i ON i.item_id=ol.item_id WHERE ol.order_id=1274 ORDER BY ol.id`)
  for (const x of l) say(`1274 line ${x.id}`, `#${x.item_id} ${x.name} x${x.qty} @${x.unit_price}`)
  say('closed lines on #20', JSON.stringify(await many(`
    SELECT i.name, COUNT(*)::int n FROM order_lines ol
    JOIN orders o ON o.order_id=ol.order_id JOIN cycles cy ON cy.id=o.cycle_id AND cy.is_active=FALSE
    JOIN items i ON i.item_id=ol.item_id WHERE ol.item_id=20 GROUP BY i.name`)))
  say('active lines on #20/new', JSON.stringify(await many(`
    SELECT ol.item_id, i.name, COUNT(*)::int n FROM order_lines ol
    JOIN orders o ON o.order_id=ol.order_id JOIN cycles cy ON cy.id=o.cycle_id AND cy.is_active
    JOIN items i ON i.item_id=ol.item_id
    WHERE ol.item_id IN (20,$1) GROUP BY ol.item_id, i.name`, [newId])))
  say('shop sku resolves to', JSON.stringify(await many(`
    SELECT i.item_id, i.name, i.is_active, bip.price FROM items i
    LEFT JOIN branch_item_prices bip ON bip.item_id=i.item_id AND bip.cycle_id=$1
    WHERE i.sku IN ('MAGGIDOUBLECUBE','RETIRED-MAGGICHICKENCUBE-2025Q3') ORDER BY i.item_id`, [act.id])))
  say('markups on old/new by cycle', JSON.stringify(await many(`
    SELECT item_id, cycle_id, COUNT(*)::int n FROM branch_item_markups
    WHERE item_id IN (20,$1) GROUP BY item_id, cycle_id ORDER BY item_id, cycle_id`, [newId])))
  say('trigger enabled', JSON.stringify(await many(`SELECT tgname, tgenabled FROM pg_trigger
    WHERE tgrelid='items'::regclass AND NOT tgisinternal`)))
  say('order_lines / items totals', `${(await one(`SELECT COUNT(*)::int n FROM order_lines`)).n} / ${(await one(`SELECT COUNT(*)::int n FROM items`)).n}`)

  if (DRY) { await c.query('ROLLBACK'); console.log('\nrolled back (dry run)') }
  else { await c.query('COMMIT'); console.log('\nCOMMITTED') }
} catch (e) {
  try { await c.query('ROLLBACK') } catch {}
  console.error('\nFAILED — rolled back:', e.message)
  process.exitCode = 1
} finally {
  console.log('final trigger state:', JSON.stringify(
    await many(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='items'::regclass AND NOT tgisinternal`).catch(() => [])))
  await c.end()
}
