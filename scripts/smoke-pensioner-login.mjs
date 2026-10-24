// SMOKE — pensioner password-only sign-in against a running dev server.
// 1. Pick an email-less, portal-enabled "P" member
// 2. Set a temporary local password hash directly in the DB
// 3. Drive /api/members/auth/check (wrong → no_password), login (wrong pw →
//    401; right pw → cookie; session → ok)
// 4. Clean the password_hash back to NULL
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'
import crypto from 'node:crypto'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const BASE = process.env.SMOKE_BASE || 'http://localhost:3000'
const TEST_PW = 'smoke-test-42'

const hashPw = (pw) => {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 })
  return `$scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`
}

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const pick = await c.query(`
  SELECT member_id FROM members
  WHERE member_id ILIKE 'P%' AND (email IS NULL OR email = '')
    AND COALESCE(portal_enabled, true) AND password_hash IS NULL
  ORDER BY member_id LIMIT 1`)
if (!pick.rows.length) { console.log('No eligible P member found for smoke'); process.exit(0) }
const MID = pick.rows[0].member_id
console.log('smoke member:', MID)

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1) } ; console.log('ok:', msg) }

try {
  // also verify the no-password check first
  let res = await fetch(BASE + '/api/members/auth/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: MID }),
  })
  let data = await res.json()
  assert(data.exists === true, 'check: member exists')
  assert(data.passwordOnly === true, 'check: passwordOnly=true')
  assert(data.hasPassword === false, 'check: hasPassword=false before setup')

  // set the temp password
  await c.query('UPDATE members SET password_hash = $1, password_set_at = now() WHERE member_id = $2', [hashPw(TEST_PW), MID])

  res = await fetch(BASE + '/api/members/auth/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: MID }),
  })
  data = await res.json()
  assert(data.hasPassword === true, 'check: hasPassword=true after setup')

  // wrong password → 401
  res = await fetch(BASE + '/api/members/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: MID, password: 'wrong-pass' }),
  })
  assert(res.status === 401, `login with wrong password → 401 (got ${res.status})`)

  // correct password → 200 + cookie
  res = await fetch(BASE + '/api/members/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: MID, password: TEST_PW }),
  })
  data = await res.json()
  assert(res.status === 200 && data.success === true, `login with correct password → 200 (got ${res.status})`)
  const setCookie = res.headers.get('set-cookie') || ''
  assert(/member_token=/.test(setCookie), 'login: member_token cookie issued')
  const token = /member_token=([^;]+)/.exec(setCookie)?.[1]

  // session endpoint accepts the new cookie
  res = await fetch(BASE + '/api/members/session', {
    headers: { cookie: `member_token=${token}` },
  })
  data = await res.json()
  assert(data.ok === true && data.member?.member_id === MID, 'session: member_token accepted')
  console.log('claims:', JSON.stringify(data.member))
} finally {
  await c.query('UPDATE members SET password_hash = NULL, password_set_at = NULL WHERE member_id = $1', [MID])
  console.log('cleaned up password_hash for', MID)
  await c.end()
}
console.log('SMOKE PASSED')
