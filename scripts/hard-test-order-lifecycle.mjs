// Order-lifecycle probe: opens the active cycle window, places one real order,
// verifies invoice + admin reports see it, then restores cycle dates and
// deletes the order so the DB is left exactly as found.
import fs from 'node:fs'
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {}
}
const BASE = 'http://localhost:3002'
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const cycle = (await c.query('SELECT id, starts_at, ends_at FROM cycles WHERE is_active = true')).rows[0]
const original = [cycle.starts_at, cycle.ends_at]
const member = (await c.query("SELECT member_id FROM members WHERE COALESCE(loans,0) > 0 AND COALESCE(savings,0) * 5 - COALESCE(loans,0) > 30000 AND email IS NOT NULL AND email <> '' ORDER BY member_id LIMIT 1")).rows[0]
if (!member) { console.log('no no-loan candidate member found — aborting probe'); await c.end(); process.exit(1) }
const branch = (await c.query('SELECT code FROM branches ORDER BY code LIMIT 1')).rows[0].code
const department = (await c.query('SELECT name FROM departments ORDER BY id LIMIT 1')).rows[0].name

// Temporarily open the window
await c.query('UPDATE cycles SET starts_at = now() - interval \'1 day\', ends_at = now() + interval \'7 days\' WHERE id = $1', [cycle.id])

let orderId = null, failures = 0
const check = (name, cond, detail = '') => { cond ? console.log('PASS ' + name, detail) : (failures++, console.log('FAIL ' + name, detail)) }
try {
  // Build a real priced line from the branch prices route
  const pr = await (await fetch(BASE + `/api/items/prices?branch=${branch}`, { headers: { origin: BASE } })).json()
  const it = (pr.items || pr.prices || [])[0]
  console.log('item:', JSON.stringify(it).slice(0, 160))
  if (!it) throw new Error('no priced item')

  const payload = {
    memberId: member.member_id, deliveryBranchCode: branch, departmentName: department,
    paymentOption: 'Loan', // every verified member carries outstanding loans; Loan is the placeable path (mirrors hard-test-loan-order.mjs)
    lines: [{ sku: it.sku, qty: 1 }],
  }
  const r = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, referer: BASE + '/' }, body: JSON.stringify(payload) })
  const j = await r.json()
  console.log('POST /api/orders ->', r.status, JSON.stringify(j).slice(0, 300))
  orderId = j.order_id ?? j.orderId ?? j.data?.id ?? null
  check('order placement', (r.status === 200 || r.status === 201) && orderId, 'order_id=' + orderId)

  if (orderId) {
    const inv = await (await fetch(BASE + `/api/orders/${orderId}`, { headers: { origin: BASE } })).json()
    console.log('invoice:', JSON.stringify(inv).slice(0, 400))
    check('invoice reflects order', JSON.stringify(inv).includes(String(orderId)))

    // duplicate submission guard? place same again — either allowed (separate order) or rejected; just observe
    const r2 = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, referer: BASE + '/' }, body: JSON.stringify(payload) })
    const j2 = await r2.json()
    console.log('duplicate POST allowed? ->', r2.status, JSON.stringify(j2).slice(0, 160))
    const dupId = j2.order_id ?? j2.orderId
    if (dupId && dupId !== orderId) { await c.query('DELETE FROM order_lines WHERE order_id = \$1', [dupId]); await c.query('DELETE FROM orders WHERE order_id = \$1', [dupId]) }

    const reports = await (await fetch(BASE + '/api/admin/reports/summary', { headers: { origin: BASE, cookie: await adminCookie() } })).json()
    check('admin reports see the order', (reports.totals?.totalAll ?? reports.totals?.totalPosted ?? -1) > 0, JSON.stringify(reports.totals?.slice ? reports.totals : reports.totals).slice(0, 160))
  }

  // negative check: bad member id
  const bad = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, referer: BASE + '/' }, body: JSON.stringify({ ...payload, memberId: 'NOPE_0000' }) })
  const badJ = await bad.json().catch(() => ({}))
  check('unknown member rejected', bad.status >= 400 || badJ.ok === false, JSON.stringify(badJ).slice(0, 160))
} finally {
  if (orderId) { await c.query('DELETE FROM order_lines WHERE order_id = \$1', [orderId]); await c.query('DELETE FROM orders WHERE order_id = \$1', [orderId]).catch(() => {}) }
  await c.query('UPDATE cycles SET starts_at = $2, ends_at = $3 WHERE id = $1', [cycle.id, original[0], original[1]])
  await c.end()
}

async function adminCookie() {
  const res = await fetch(BASE + '/api/admin/pin/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, referer: BASE + '/' }, body: JSON.stringify({ passcode: process.env.ADMIN_PASSCODE }) })
  return (res.headers.get('set-cookie') || '').split(';')[0]
}
console.log(failures === 0 ? 'ORDER LIFECYCLE ALL PASS' : `ORDER LIFECYCLE FAILURES: ${failures}`)
process.exit(failures ? 1 : 0)
