import 'dotenv/config'
import fs from 'node:fs'
const BASE = process.env.PROD_BASE_URL || 'https://sales.cbncoopng.com'
function readPasscode() {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const txt = fs.readFileSync(f, 'utf8')
      const m = txt.match(/^ADMIN_PASSCODE=(.*)$/m)
      if (m) return m[1].trim().replace(/^[\"']|[\"']$/g, '')
    } catch {}
  }
  return process.env.ADMIN_PASSCODE
}
const passcode = readPasscode()
if (!passcode) { console.error('No ADMIN_PASSCODE found'); process.exit(1) }
const login = await fetch(`${BASE}/api/admin/pin/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passcode }),
})
console.log('login:', login.status)
if (!login.ok) process.exit(1)
const setCookie = login.headers.get('set-cookie') || ''
const token = /admin_token=([^;]+)/.exec(setCookie)?.[1]
const cookie = `admin_token=${token}`
const schema = await (await fetch(`${BASE}/api/admin/import/members/schema`, { headers: { cookie } })).json()
const hasEmail = (schema.columns || []).some(c => c.key === 'email')
console.log('members template has email column:', hasEmail)
console.log('columns:', (schema.columns || []).map(c => c.key).join(', '))
