// Read-only production verification for the branch-pack deploy:
// logs in with the admin passcode (ONE POST /api/admin/pin/session), then GETs
// /api/admin/reports/branch-pack and decodes the returned base64 workbook to
// confirm the deployed build emits the new "Sku" column. No writes anywhere.
import 'dotenv/config'
import fs from 'node:fs'
import * as XLSX from 'xlsx/xlsx.mjs'

const BASE = process.env.PROD_BASE_URL || 'https://sales.cbncoopng.com'

function readPasscode() {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const txt = fs.readFileSync(f, 'utf8')
      const m = txt.match(/^ADMIN_PASSCODE=(.*)$/m)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    } catch {}
  }
  return process.env.ADMIN_PASSCODE
}

const passcode = readPasscode()
if (!passcode) { console.error('No ADMIN_PASSCODE found'); process.exit(1) }

const login = await fetch(`${BASE}/api/admin/pin/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passcode }),
})
console.log('login:', login.status)
if (!login.ok) process.exit(1)
const setCookie = login.headers.get('set-cookie') || ''
const token = /admin_token=([^;]+)/.exec(setCookie)?.[1]
if (!token) { console.error('No admin_token cookie'); process.exit(1) }

const res = await fetch(`${BASE}/api/admin/reports/branch-pack`, {
  headers: { cookie: `admin_token=${token}` },
})
console.log('branch-pack:', res.status)
const json = await res.json().catch(() => ({}))
if (!json.ok || !json.data) {
  console.error('unexpected branch-pack response:', JSON.stringify(json).slice(0, 200))
  process.exit(1)
}

const wb = XLSX.read(Buffer.from(json.data, 'base64'), { type: 'buffer' })
console.log('sheets:', wb.SheetNames.join(', '))
let allGood = true
let totalRows = 0
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name])
  const headers = rows.length ? Object.keys(rows[0]) : []
  const hasSku = headers.includes('Sku')
  console.log(`- ${name}: rows=${rows.length} headers=${headers.slice(0, 6).join('|')}${headers.length > 6 ? '...' : ''} Sku=${hasSku}`)
  if (rows.length && !hasSku) allGood = false
  totalRows += rows.length
}
console.log(allGood ? 'SKU COLUMN PRESENT — DEPLOY IS LIVE' : 'SKU COLUMN MISSING or NO DATA — inconclusive for empty sheets')
if (totalRows === 0) {
  console.log('NOTE: v_master_sheet has no Posted/Delivered rows in the active cycle, so the workbook is empty and this check cannot distinguish builds. Re-run when orders post.')
}
process.exit(allGood ? 0 : 2)
