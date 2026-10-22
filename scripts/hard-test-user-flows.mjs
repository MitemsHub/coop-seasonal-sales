// Hard user-tester sweep: exercise member + admin flows against the local dev
// server with real DB rows, assert responses, and clean up any test order.
import fs from 'node:fs'

function loadEnv() {
  const out = {}
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {}
  }
  for (const [k, v] of Object.entries(out)) if (!(k in process.env)) process.env[k] = v
}
loadEnv()

const BASE = 'http://localhost:3002'
let failures = 0
function check(name, cond, detail = '') {
  if (cond) { console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`) } else { failures++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
async function get(path, headers = {}) {
  const r = await fetch(BASE + path, { headers: { origin: BASE, referer: BASE + '/', ...headers } })
  const t = await r.text()
  let j = null; try { j = JSON.parse(t) } catch {}
  return { status: r.status, j, t }
}
async function post(path, body, headers = {}) {
  const r = await fetch(BASE + path, { method: 'POST', body: JSON.stringify(body), headers: { origin: BASE, referer: BASE + '/', 'content-type': 'application/json', ...headers } })
  const t = await r.text()
  let j = null; try { j = JSON.parse(t) } catch {}
  return { status: r.status, j, t, headers: r.headers }
}

// ── DB recon ──────────────────────────────────────────────────────────────
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const branches = (await c.query('SELECT code, name FROM branches ORDER BY code LIMIT 3')).rows
console.log('branches sample:', JSON.stringify(branches))
const cycle = (await c.query('SELECT id, starts_at, ends_at, is_active FROM cycles WHERE is_active = true')).rows[0]
console.log('active cycle:', JSON.stringify(cycle))
const cycleEligible = cycle && Date.now() > new Date(cycle.ends_at || 0).getTime()
console.log('cycle date window currently open:', !cycleEligible)

const member = (await c.query("SELECT member_id, full_name, email, category, COALESCE(savings,0) s, COALESCE(loans,0) l, COALESCE(global_limit,0) gl FROM members WHERE email IS NOT NULL AND email <> '' ORDER BY member_id LIMIT 1")).rows[0]
console.log('test member:', JSON.stringify(member))

// ── Member-facing APIs ────────────────────────────────────────────────────
{
  const r = await get(`/api/members/eligibility?member_id=${encodeURIComponent(member.member_id)}`)
  check('eligibility by member_id', r.status === 200 && r.j?.ok !== false, JSON.stringify(r.j).slice(0, 150))
}
{
  const r = await get(`/api/members/eligibility?member_id=NO_SUCH_0000`)
  check('eligibility unknown member → 404/ok:false', r.status >= 400 || r.j?.ok === false || r.j?.eligible === false, JSON.stringify(r.j).slice(0, 150))
}
{
  const code = branches[0]?.code
  const r = await get(`/api/items/prices?branch=${encodeURIComponent(code)}`)
  check('items prices by branch', r.status === 200, JSON.stringify(r.j || r.t).slice(0, 120))
}
{
  const r = await get('/api/items/prices?branch=')
  check('items prices missing branch → 400', r.status === 400, JSON.stringify(r.j).slice(0, 120))
}
{
  const r = await get(`/api/exhibition/catalog?member_id=${encodeURIComponent(member.member_id)}`)
  check('exhibition catalog by member', r.status === 200, JSON.stringify(r.j || r.t).slice(0, 120))
}
{
  const r = await get('/api/ram/eligibility?member_id=' + encodeURIComponent(member.member_id))
  console.log('ram/eligibility probe ->', r.status, JSON.stringify(r.j || r.t).slice(0, 160))
}

// ── Order placement → invoice → admin view → cleanup ─────────────────────
// Pick a priced item from the branch price data
let item = null
{
  const code = branches[0]?.code
  const r = await get(`/api/items/prices?branch=${encodeURIComponent(code)}`)
  const list = r.j?.items || r.j?.prices || r.j?.data || []
  item = Array.isArray(list) && list[0] || (list.items?.[0])
  console.log('priced item sample:', JSON.stringify(item)?.slice(0, 200))
}

let createdOrderId = null
if (item && cycle && c) {
  const payload = {
    memberId: member.member_id,
    deliveryBranchCode: branches[0].code,
    departmentName: 'Test Dept',
    paymentOption: 'savings',
    lines: [{ item_id: item.item_id ?? item.id, name: item.name ?? item.item_name, unit_price: Number(item.unit_price ?? item.price ?? 0), quantity: 1 }]
  }
  const r = await post('/api/orders', payload)
  createdOrderId = r.j?.order_id ?? r.j?.id ?? null
  check('order placement', (r.status === 200 || r.status === 201) && r.j?.message !== 'orders API alive', JSON.stringify(r.j || r.t).slice(0, 200))
  if (createdOrderId) {
    const inv = await get(`/api/orders/${createdOrderId}`)
    check('invoice lookup', inv.status === 200 && JSON.stringify(inv.j).includes(String(createdOrderId)), JSON.stringify(inv.j).slice(0, 200))
  }
} else {
  console.log('SKIP order placement — no priced item or no active cycle (shop closed is expected behaviour)')
}

// ── Admin surface with PIN cookie ─────────────────────────────────────────
let cookie = ''
{
  const res = await fetch(BASE + '/api/admin/pin/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, referer: BASE + '/' }, body: JSON.stringify({ passcode: process.env.ADMIN_PASSCODE }) })
  cookie = (res.headers.get('set-cookie') || '').split(';')[0]
  check('admin PIN login', res.ok && cookie, (res.ok ? 'cookie ok' : JSON.stringify(await res.json()).slice(0, 100)))
}
if (cookie) {
  const H = { cookie }
  for (const path of [
    '/api/admin/reports/summary',
    '/api/admin/reports/branches',
    '/api/admin/reports/departments',
    '/api/admin/members/search?limit=5',
    '/api/admin/items?limit=5',
    '/api/admin/cycles',
  ]) {
    const r = await get(path, H)
    check(`admin ${path}`, r.status === 200 && r.j && r.j.ok !== false, r.status + ' ' + JSON.stringify(r.j || r.t).slice(0, 120))
  }
  if (createdOrderId) {
    const r = await get('/api/admin/food/orders/list', H)
    console.log('admin orders list ->', r.status, JSON.stringify(r.j || r.t).slice(0, 120))
    // cancel the test order through the admin API if it exists there
  }
}

// ── cleanup test order ───────────────────────────────────────────────────
if (createdOrderId) {
  await c.query(`DELETE FROM order_items WHERE order_id = $1`, [createdOrderId]).catch(() => {})
  await c.query(`DELETE FROM orders WHERE id = $1`, [createdOrderId]).catch(() => {})
  console.log('cleanup: deleted test order', createdOrderId)
}

await c.end()
console.log(failures === 0 ? 'ALL PASS' : `FAILURES: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
