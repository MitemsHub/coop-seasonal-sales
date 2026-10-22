// One-off round-trip verification for the alternative_email member import.
// Signs in as admin against the local dev server, posts a 2-row workbook
// (one with both emails, one with blanks), verifies what landed in the DB,
// then deletes the test rows.
import fs from 'node:fs'

if (!process.env.ADMIN_PASSCODE) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^ADMIN_PASSCODE=(.*)$/m)
      if (m && m[1].trim()) { process.env.ADMIN_PASSCODE = m[1].trim(); break }
    } catch {}
  }
}

const XLSX = await import('xlsx/xlsx.mjs')

// Mirror of the schema route's COLUMNS keys — order asserted below.
const EXPECTED_HEADERS = ['member_id', 'full_name', 'email', 'alternative_email', 'grade', 'savings', 'loans', 'global_limit']
console.log('expected template headers:', EXPECTED_HEADERS.join(', '))
console.log('alt column present:', EXPECTED_HEADERS.includes('alternative_email'))

const rows = [
  { member_id: 'TESTALTA01', full_name: 'Alt Email Tester', email: 'alttest-primary@example.com', alternative_email: 'alttest-secondary@example.com', grade: '', savings: 1000, loans: 0, global_limit: 5000 },
  { member_id: 'TESTALTA02', full_name: 'Blank Alt Tester', email: '', alternative_email: '', grade: '', savings: 1000, loans: 0, global_limit: 5000 },
]
const wb = XLSX.utils.book_new()
const ws = XLSX.utils.json_to_sheet(rows, { header: EXPECTED_HEADERS })
XLSX.utils.book_append_sheet(wb, ws, 'Members')
const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
const fd = new FormData()
fd.append('file', new Blob([buf]), 'members-test.xlsx')

const PIN = process.env.ADMIN_PASSCODE
if (!PIN) {
  console.log('NO ADMIN_PASSCODE env — import round-trip requires an admin session; skipping POST')
  process.exit(0)
}
const BASE = 'http://localhost:3002'
const pinRes = await fetch(BASE + '/api/admin/pin/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', origin: BASE, referer: BASE + '/' },
  body: JSON.stringify({ passcode: PIN }),
})
if (!pinRes.ok) {
  console.log('PIN sign-in failed with status', pinRes.status, '— cannot run admin-import round trip')
  process.exit(0)
}
const cookie = (pinRes.headers.get('set-cookie') || '').split(';')[0]
console.log('admin session cookie obtained:', cookie ? 'yes' : 'no')

const res2 = await fetch(BASE + '/api/admin/import/members', {
  method: 'POST',
  body: fd,
  headers: { cookie, origin: BASE, referer: BASE + '/' },
})
const bodyText = await res2.text()
let j2 = null
try { j2 = JSON.parse(bodyText) } catch {}
console.log('import status:', res2.status, j2 ? JSON.stringify(j2) : bodyText)

// Verify what actually landed in the DB
const pg = (await import('pg')).default
let url = process.env.SUPABASE_DB_URL
if (!url) for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { const m = fs.readFileSync(f, 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m); if (m) { url = m[1].replace(/^["']|["']$/g, ''); break } } catch {}
}
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const check = await c.query("SELECT member_id, email, alternative_email FROM members WHERE member_id IN ('TESTALTA01','TESTALTA02') ORDER BY member_id")
for (const r of check.rows) console.log('row:', JSON.stringify(r))
// Cleanup: remove test rows, leaving the members table clean
await c.query("DELETE FROM members WHERE member_id IN ('TESTALTA01','TESTALTA02')")
console.log('test rows cleaned up')
await c.end()
