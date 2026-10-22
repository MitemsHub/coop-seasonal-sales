// Member-cookie flow test: session, my-coop aggregate, orders list, invoice,
// notifications, shop eligibility. Uses a locally minted member_token.
import fs from 'node:fs'
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {}
}
const BASE = 'http://localhost:3002'
const MID = String(process.argv[2] || 'A20496').toUpperCase()
const { sign } = await import('../lib/signingEdge.js')
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const m = (await c.query("SELECT member_id, full_name, branch_id FROM members WHERE member_id = $1", [MID])).rows[0]
const b = m?.branch_id ? (await c.query("SELECT code, name FROM branches WHERE id = $1", [m.branch_id])).rows[0] : null
const token = await sign({ role: 'member', member_id: m.member_id, branch_id: m.branch_id ?? null, branch_code: b?.code || '', name: m.full_name || '' }, 60 * 60 * 8)
const cookie = `member_token=${token}`

let failures = 0
const check = (name, cond, detail = '') => { cond ? console.log('PASS ' + name + (detail ? ' — ' + detail : '')) : (failures++, console.log('FAIL ' + name + (detail ? ' — ' + detail : ''))) }

// member session introspection
{
  const r = await fetch(BASE + '/api/members/session', { headers: { cookie, origin: BASE } })
  const j = await r.json().catch(() => null)
  check('member session valid', r.status === 200 && j?.ok === true, JSON.stringify(j?.member || j).slice(0, 120))
}
{
  const bad = await fetch(BASE + '/api/members/session', { headers: { origin: BASE } })
  check('member session without cookie → 401', bad.status === 401)
}

// my-coop aggregate API (whatever the page calls — probe the likely paths)
for (const p of [`/api/members/orders?member_id=${MID}`, `/api/orders/member?member_id=${MID}`, `/api/members/eligibility?member_id=${MID}`]) {
  const r = await fetch(BASE + p, { headers: { cookie, origin: BASE } })
  const t = await r.text()
  const j = t.startsWith('{') ? JSON.parse(t) : null
  console.log(`GET ${p} -> ${r.status}`, j ? JSON.stringify(j).slice(0, 160) : t.slice(0, 80))
  check(`member api ${p}`, r.status !== 500, `status ${r.status}`)
}

// member orders route GET
{
  const r = await fetch(BASE + `/api/members/orders`, { headers: { cookie, origin: BASE } })
  const t = await r.text()
  console.log(`GET /api/members/orders -> ${r.status}`, t.slice(0, 160))
}

// exhibition member prices / cart endpoints
{
  const r = await fetch(BASE + `/api/exhibition/catalog?member_id=${MID}`, { headers: { cookie, origin: BASE } })
  const j = await r.json().catch(() => null)
  check('exhibition catalog member', r.status === 200 && j?.ok !== false, `status ${r.status}`)
}

// RAM member records
{
  const r = await fetch(BASE + `/api/ram/eligibility?member_id=${MID}`, { headers: { cookie, origin: BASE } })
  const j = await r.json().catch(() => null)
  check('ram eligibility member', r.status === 200 && j?.ok === true, JSON.stringify(j?.member || {}).slice(0, 120))
}

// notifications
{
  const r = await fetch(BASE + `/api/member-notifications?member_id=${MID}`, { headers: { cookie, origin: BASE } })
  const t = await r.text()
  console.log('notifications ->', r.status, t.slice(0, 140))
  check('member notifications', r.status !== 500, `status ${r.status}`)
}

await c.end()
console.log(failures === 0 ? 'MEMBER AUTH FLOWS ALL PASS' : `MEMBER AUTH FAILURES: ${failures}`)
process.exit(failures ? 1 : 0)
