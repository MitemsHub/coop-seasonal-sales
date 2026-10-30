import fs from 'node:fs'
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {}
}
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0]
const many = async (sql, p = []) => (await c.query(sql, p)).rows
const say = (k, v) => console.log(`  ${String(k).padEnd(44)} ${v}`)

const GL = { 'Kings Oil 5Ltrs': 131100, 'Optimum Rice 50Kg': 56500, 'Nido Milk 12g': 25136,
  'Milo 20G': 69570, 'Maggi Chicken Cube': 46046, 'Super Pack Noodles': 30000,
  'Good Mama 800G': 21000, 'Golden Penny Semovita 1Kg': 30100, 'Golden Penny Spaghetti': 37500,
  'Nextel Rice 25Kg': 88500, 'Gino Tomatoes Sachet': 16000 }

console.log('== A. order 1274 vs finance journal JV/14451 — final ==')
const l = await many(`SELECT ol.id, i.item_id, i.name, ol.qty, ol.unit_price, ol.amount
  FROM order_lines ol JOIN items i ON i.item_id=ol.item_id
  WHERE ol.order_id=1274 ORDER BY ol.id`)
let hit = 0
for (const [g, amt] of Object.entries(GL)) {
  const m = l.find(x => Number(x.amount) === amt)
  const ok = m && m.name === g
  if (ok) hit++
  say(ok ? 'MATCH' : 'DIFF', `"${g}"  <->  ${m ? `#${m.item_id} ${m.name}` : 'no line'}`)
}
say('lines matching the journal', `${hit}/${Object.keys(GL).length}`)

console.log('\n== B. the two repaired rows ==')
console.log(JSON.stringify(await many(`SELECT item_id, sku, name, unit, category, is_active, image_url
  FROM items WHERE item_id IN (3,360,361,20,474) ORDER BY item_id`), null, 1))
say('closed-cycle lines by row', JSON.stringify(await many(`
  SELECT ol.item_id, i.name, COUNT(*)::int n FROM order_lines ol
  JOIN orders o ON o.order_id=ol.order_id JOIN cycles cy ON cy.id=o.cycle_id AND cy.is_active=FALSE
  JOIN items i ON i.item_id=ol.item_id
  WHERE ol.item_id IN (3,20,360,474) GROUP BY ol.item_id, i.name ORDER BY ol.item_id`)))
say('active-cycle lines by row', JSON.stringify(await many(`
  SELECT ol.item_id, i.name, COUNT(*)::int n FROM order_lines ol
  JOIN orders o ON o.order_id=ol.order_id JOIN cycles cy ON cy.id=o.cycle_id AND cy.is_active
  JOIN items i ON i.item_id=ol.item_id
  WHERE ol.item_id IN (3,20,360,474) GROUP BY ol.item_id, i.name ORDER BY ol.item_id`)))
say('shop SKUs resolve to one active row', JSON.stringify(await many(`
  SELECT sku, COUNT(*)::int n, COUNT(*) FILTER (WHERE is_active)::int active FROM items
  WHERE sku IN ('FRESHREDOIL5L','MAGGIDOUBLECUBE','GPSEMOVITA1KG') GROUP BY sku`)))
say('duplicate skus anywhere', (await one(`SELECT COUNT(*)::int n FROM (SELECT sku FROM items GROUP BY sku HAVING COUNT(*)>1) x`)).n)

console.log('\n== C. closed-cycle receipts still showing a name that changed since ==')
// any closed-cycle line whose item name differs from... we cannot know history for
// all rows, so list every closed-cycle line on a row that was touched in Oct 2026
// (image ?v= bumped) — those are the rows with churn fingerprints.
say('rows with churned image + closed lines', JSON.stringify(await many(`
  SELECT i.item_id, i.name, i.sku, COUNT(DISTINCT ol.id)::int closed_lines
  FROM items i JOIN order_lines ol ON ol.item_id=i.item_id
  JOIN orders o ON o.order_id=ol.order_id JOIN cycles cy ON cy.id=o.cycle_id AND cy.is_active=FALSE
  WHERE i.image_url LIKE '%?v=179%' OR i.image_url LIKE '%?v=178%'
  GROUP BY i.item_id, i.name, i.sku ORDER BY closed_lines DESC`)))

console.log('\n== D. sweep: item names in cycle-1 audit notes that no longer exist ==')
const notes = await many(`SELECT id, at, detail FROM audit_log
  WHERE at >= '2025-11-01' AND at < '2026-02-01' AND detail IS NOT NULL`)
const catalogue = (await many(`SELECT DISTINCT name FROM items`)).map(r => r.name.toLowerCase())
const junk = /not collect|not deliver|deliver|collect|rep|other|all |savings|loan|cash|posted|approved|cancel|paid|balance|picked|pack|status|flag/i
const frags = new Map()
for (const n of notes) {
  const txt = typeof n.detail === 'string' ? n.detail : Object.values(n.detail || {}).join(' ')
  for (let f of txt.split(/,|;|\band\b/gi)) {
    f = f.replace(/[{}"]/g, '').replace(/\s+/g, ' ').trim()
    if (f.length < 6 || junk.test(f)) continue
    if (catalogue.includes(f.toLowerCase())) continue
    if (!frags.has(f)) frags.set(f, n.id)
  }
}
if (!frags.size) console.log('  (no unmatched names in cycle-1 notes)')
for (const [f, id] of frags) console.log(`  CANDIDATE  "${f}"   (audit_log #${id})`)

console.log('\n== E. guarantees still in force ==')
say('freeze trigger', JSON.stringify(await many(`SELECT tgname, tgenabled FROM pg_trigger
  WHERE tgrelid='items'::regclass AND NOT tgisinternal`)))
await c.query('BEGIN')
try { await c.query(`UPDATE items SET name='HACKED' WHERE item_id=20`); say('rename of #20', 'ALLOWED — BAD') }
catch (e) { say('rename of #20 rejected', e.message.slice(0, 120)) }
await c.query('ROLLBACK')
say('reprice fn active-cycle only', JSON.stringify(await one(
  `SELECT (pg_get_functiondef('reprice_orders_for_branch_item(bigint,bigint)'::regprocedure) LIKE '%cy.is_active = TRUE%') AS guarded`)))

await c.end()
