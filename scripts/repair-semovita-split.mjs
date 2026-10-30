// REPAIR: restore item #3's cycle-1 identity ("Golden Penny Semovita 1Kg") and
// move this year's Fresh Red Oil business onto the oil row #360.
//
// Evidence that #3 was Golden Penny Semovita 1Kg in cycle 1:
//   • Finance journal JV/14451 posted 13.01.2026 for order 1274 describes the
//     line of NGN 30,100 as "2 Golden Penny Semovita 1Kg {2025 SEASONAL S}".
//     That line is item #3 (2 x 15,050 = 30,100), and no other line matches.
//   • storage.objects: items/GPSEMOVITA1KG.png was uploaded 2025-10-27 (cycle-1
//     catalogue build); items/FRESHREDOIL5L.png only exists from 2026-10-20 —
//     the churn window during which #3 was renamed away from its real identity
//     (documented in scripts/repair-crosslink-2026-10-20.mjs).
//   • #3's cycle-1 price vector (14,300–20,000, 31 branches) matches this year's
//     semovita 1Kg row #361 (14,500/15,000), not the vegetable-oil range.
//   • Order 1274's other 10 lines match the journal's descriptions exactly.
//
// This year's oil business (survey entry #504, Enugu 14,500, 3 lines) lives on
// #3 and must survive, so it moves to #360 — the existing retired oil row —
// which takes back sku FRESHREDOIL5L, so the shop's SKU is unchanged.
//
// The freeze trigger is disabled ONLY inside this savepoint, for this one
// corrective rename, and re-enabled before COMMIT. A failure rolls back the
// whole transaction, restoring the trigger with it.
//
// Usage: node scripts/repair-semovita-split.mjs [--dry]

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
const say = (k, v) => console.log(`  ${k.padEnd(46)} ${v}`)

try {
  console.log('== preflight (state must match expectations) ==')
  const i3 = await one(`SELECT item_id, name, sku, unit, category, is_active FROM items WHERE item_id = 3`)
  const i360 = await one(`SELECT item_id, name, sku, is_active FROM items WHERE item_id = 360`)
  const i361 = await one(`SELECT item_id, name, sku, unit, category, image_url FROM items WHERE item_id = 361`)
  const act = await one(`SELECT id FROM cycles WHERE is_active`)
  const closed = await many(`SELECT id FROM cycles WHERE NOT is_active`)
  const closedIds = closed.map(r => r.id)
  const stat = {
    '#3 renders': `${i3.name} / ${i3.sku} / active=${i3.is_active}`,
    '#360 renders': `${i360.name} / ${i360.sku} / active=${i360.is_active}`,
    '#361 (this years semovita)': `${i361.name} / ${i361.sku} / ${i361.unit} / ${i361.category}`,
    'active cycle': act.id,
    '#3 closed lines': (await one(`SELECT COUNT(*)::int n FROM order_lines ol
      JOIN orders o ON o.order_id=ol.order_id WHERE ol.item_id=3 AND o.cycle_id = ANY($1)`, [closedIds])).n,
    '#3 active lines': (await one(`SELECT COUNT(*)::int n FROM order_lines ol
      JOIN orders o ON o.order_id=ol.order_id WHERE ol.item_id=3 AND o.cycle_id = $1`, [act.id])).n,
    '#3 active price rows': (await one(`SELECT COUNT(*)::int n FROM branch_item_prices
      WHERE item_id=3 AND cycle_id=$1`, [act.id])).n,
    '#360 lines/prices': `${(await one(`SELECT COUNT(*)::int n FROM order_lines WHERE item_id=360`)).n}/${(await one(`SELECT COUNT(*)::int n FROM branch_item_prices WHERE item_id=360`)).n}`,
    'survey rows on #3': (await one(`SELECT COUNT(*)::int n FROM food_survey_entries WHERE saved_item_id=3`)).n,
    'sku conflicts': (await one(`SELECT COUNT(*)::int n FROM items
      WHERE sku IN ('FRESHREDOIL5L','RETIRED-GPSEMOVITA1KG-2025Q3')`)).n,
    'freeze trigger': JSON.stringify(await many(`SELECT tgname, tgenabled FROM pg_trigger
      WHERE tgrelid='items'::regclass AND NOT tgisinternal`)),
  }
  for (const [k, v] of Object.entries(stat)) say(k, v)

  const ok =
    i3.name === 'Fresh Red Oil 5L' && i3.sku === 'FRESHREDOIL5L' &&
    i360.sku === 'RETIRED-FRESHREDOIL5L-GENERAL' && i360.is_active === false &&
    stat['#3 closed lines'] === 165 && stat['#3 active lines'] === 3 &&
    stat['#3 active price rows'] === 1 && stat['#360 lines/prices'] === '0/0' &&
    stat['survey rows on #3'] === 1 && stat['sku conflicts'] === 1
  if (!ok) throw new Error('preflight mismatch — refusing to run')
  console.log('  preflight: OK\n')

  await c.query('BEGIN')
  const step = async (label, sql, p = []) => {
    const r = await c.query(sql, p)
    say(label, `${r.rowCount} row(s)`)
    return r.rowCount
  }

  console.log('== apply ==')
  // 1. free the shop SKU on #3 (sku is not guarded by the freeze trigger)
  step('#3 sku -> retired tombstone', `UPDATE items SET sku='RETIRED-GPSEMOVITA1KG-2025Q3'
    WHERE item_id=3 AND sku='FRESHREDOIL5L'`)
  // 2. revive the oil row with the shop's real SKU
  step('#360 sku -> FRESHREDOIL5L, active', `UPDATE items
    SET sku='FRESHREDOIL5L', is_active=TRUE, name='Fresh Red Oil 5L'
    WHERE item_id=360 AND sku='RETIRED-FRESHREDOIL5L-GENERAL'`)
  // 3. this year's Enugu price row follows the oil product
  step('active price row 3 -> 360', `UPDATE branch_item_prices SET item_id=360
    WHERE item_id=3 AND cycle_id=$1`, [act.id])
  // 4. this year's oil orders follow the oil product
  step('active order lines 3 -> 360', `UPDATE order_lines ol SET item_id=360
    FROM orders o WHERE ol.order_id=o.order_id AND ol.item_id=3 AND o.cycle_id=$1`, [act.id])
  // 5. the survey entry that defines this year's oil product
  step('survey entry 504 -> #360', `UPDATE food_survey_entries SET saved_item_id=360
    WHERE saved_item_id=3 AND id=504`)
  // 6. the one corrective rename, trigger bypassed only inside this savepoint
  await c.query(`SAVEPOINT freeze_bypass`)
  await c.query(`ALTER TABLE items DISABLE TRIGGER trg_protect_historical_item_identity`)
  step('#3 identity -> Golden Penny Semovita 1Kg', `UPDATE items
      SET name='Golden Penny Semovita 1Kg', unit='Bag', category='Flour',
          image_url=$1, is_active=FALSE
    WHERE item_id=3 AND name='Fresh Red Oil 5L'`, [i361.image_url])
  await c.query(`ALTER TABLE items ENABLE TRIGGER trg_protect_historical_item_identity`)
  await c.query(`RELEASE SAVEPOINT freeze_bypass`)

  console.log('\n== in-transaction verification ==')
  const t1274 = await many(`SELECT ol.id, i.item_id, i.name, ol.qty, ol.unit_price, ol.amount
    FROM order_lines ol JOIN items i ON i.item_id=ol.item_id
    WHERE ol.order_id=1274 ORDER BY ol.id`)
  for (const l of t1274) say(`1274 line ${l.id}`, `#${l.item_id} ${l.name} x${l.qty} @${l.unit_price}`)
  const thisYear = await many(`SELECT ol.order_id, i.item_id, i.name, ol.amount
    FROM order_lines ol JOIN orders o ON o.order_id=ol.order_id
    JOIN items i ON i.item_id=ol.item_id
    WHERE o.cycle_id=$1 AND i.item_id IN (3,360) ORDER BY ol.order_id`, [act.id])
  console.log('  active-cycle lines on 3/360:')
  for (const l of thisYear) say(`  order ${l.order_id}`, `#${l.item_id} ${l.name} ${l.amount}`)
  say('trigger enabled', JSON.stringify(await many(`SELECT tgname, tgenabled FROM pg_trigger
    WHERE tgrelid='items'::regclass AND NOT tgisinternal`)))
  say('sku unique check', JSON.stringify(await many(`SELECT sku, COUNT(*)::int n FROM items
    WHERE sku LIKE '%FRESHREDOIL5L%' OR sku LIKE '%GPSEMOVITA1KG%' GROUP BY sku`)))
  say('total order lines', (await one(`SELECT COUNT(*)::int n FROM order_lines`)).n)
  say('order 1274 total', (await one(`SELECT total_amount FROM orders WHERE order_id=1274`)).total_amount)

  if (DRY) {
    await c.query('ROLLBACK')
    console.log('\nrolled back (dry run)')
  } else {
    await c.query('COMMIT')
    console.log('\nCOMMITTED')
  }
} catch (e) {
  try { await c.query('ROLLBACK') } catch {}
  console.error('\nFAILED — rolled back:', e.message)
  process.exitCode = 1
} finally {
  const t = await many(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='items'::regclass AND NOT tgisinternal`)
  console.log('final trigger state:', JSON.stringify(t))
  await c.end()
}
