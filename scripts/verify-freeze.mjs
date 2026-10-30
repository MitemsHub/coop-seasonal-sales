import fs from 'node:fs'
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {}
}
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0]
const many = async (sql, p = []) => (await c.query(sql, p)).rows
const say = (k, v) => console.log(`  ${String(k).padEnd(46)} ${v}`)

// Each probe runs in its own BEGIN/ROLLBACK so nothing can leak.
const probe = async (label, sql) => {
  await c.query('BEGIN')
  let out
  try { await c.query(sql); out = 'allowed' }
  catch (e) { out = 'REJECTED: ' + e.message.slice(0, 110) }
  await c.query('ROLLBACK')
  say(label, out)
}

console.log('== freeze trigger behaviour, live ==')
await probe('rename item #3 (closed-cycle lines)',
  `UPDATE items SET name='HACKED' WHERE item_id=3`)
await probe('change #3 unit/category',
  `UPDATE items SET unit='Piece', category='Other' WHERE item_id=3`)
await probe('swap #3 image',
  `UPDATE items SET image_url='x.png' WHERE item_id=3`)
await probe('retire #3 (is_active, must stay allowed)',
  `UPDATE items SET is_active=FALSE WHERE item_id=3`)
await probe('no-op re-import write on #3 (must stay allowed)',
  `UPDATE items SET name=name, unit=unit, category=category, image_url=image_url WHERE item_id=3`)
await probe('rename #361 (active-cycle lines only — allowed by design)',
  `UPDATE items SET name='X' WHERE item_id=361`)

console.log('\n== state after all rollbacks ==')
say('items 3 / 360 / 361', JSON.stringify(await many(
  `SELECT item_id, name, sku, unit, category, is_active FROM items WHERE item_id IN (3,360,361) ORDER BY item_id`)))
say('order 1274 line 7620', JSON.stringify(await one(
  `SELECT ol.qty, ol.unit_price, ol.amount, i.name FROM order_lines ol JOIN items i ON i.item_id=ol.item_id WHERE ol.id=7620`)))
say('closed-cycle lines on #3 / #360', JSON.stringify(await many(`
  SELECT ol.item_id, i.name, COUNT(*)::int n FROM order_lines ol
  JOIN orders o ON o.order_id=ol.order_id JOIN cycles cy ON cy.id=o.cycle_id AND cy.is_active=FALSE
  JOIN items i ON i.item_id=ol.item_id WHERE ol.item_id IN (3,360) GROUP BY ol.item_id, i.name`)))
say('active-cycle lines on #3 / #360', JSON.stringify(await many(`
  SELECT ol.item_id, i.name, COUNT(*)::int n FROM order_lines ol
  JOIN orders o ON o.order_id=ol.order_id JOIN cycles cy ON cy.id=o.cycle_id AND cy.is_active
  JOIN items i ON i.item_id=ol.item_id WHERE ol.item_id IN (3,360) GROUP BY ol.item_id, i.name`)))

console.log('\n== the "never again" guarantees ==')
say('freeze trigger', JSON.stringify(await many(
  `SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='items'::regclass AND NOT tgisinternal`)))
say('reprice fn: active cycle only', JSON.stringify(await one(
  `SELECT (pg_get_functiondef('reprice_orders_for_branch_item(bigint,bigint)'::regprocedure) LIKE '%cy.is_active = TRUE%') AS guarded`)))
say('order_lines rows', (await one(`SELECT COUNT(*)::int n FROM order_lines`)).n)
say('items rows', (await one(`SELECT COUNT(*)::int n FROM items`)).n)
say('duplicate skus', (await one(`SELECT COUNT(*)::int n FROM (SELECT sku FROM items GROUP BY sku HAVING COUNT(*)>1) x`)).n)

await c.end()
