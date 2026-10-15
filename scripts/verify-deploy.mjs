// Read-only production verification: confirms the deployed build shows the
// previously-hidden duplicate-name survey drafts (Abeokuta "Rice" pair) and
// that no item appears in the trailing draft:null group as a duplicate.
// Uses the admin session (POST /api/admin/pin/session) with the passcode from
// .env.local — ONE attempt, then only GET requests. No writes anywhere.
import 'dotenv/config'
import fs from 'node:fs'

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
const cookie = `admin_token=${token}`

const get = async (path) => {
  const res = await fetch(BASE + path, { headers: { cookie } })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

// 1. Cycles — confirm current cycle id
const cycles = await get('/api/admin/cycles')
const cycleList = cycles.json.cycles || cycles.json.data || cycles.json.rows || cycles.json
const open = Array.isArray(cycleList) ? cycleList.find((c) => c.survey_open || c.is_active) || cycleList[0] : null
const cycleId = open?.id
console.log('cycle check:', cycles.status, cycleId ? `using cycle ${cycleId} (${open?.code || open?.name || ''})` : 'no cycle list — will try 3')

// 2. Outsourced rows
const items = await get(`/api/admin/items?section=outsourced&cycle_id=${cycleId ?? 3}`)
if (items.status !== 200 || !items.json.ok) { console.log('items:', items.status, items.json.error || ''); process.exit(1) }
const rows = items.json.rows || []

// Abeokuta same-name rows: group by (branch_name, draft_name)
const abeokuta = rows.filter((r) => (r.draft?.branch_name || '') === 'Abeokuta')
const nameCount = new Map()
for (const r of abeokuta) {
  const n = r.draft?.draft_name || r.name
  nameCount.set(n, (nameCount.get(n) || 0) + 1)
}
const rice = abeokuta.filter((r) => (r.draft?.draft_name || '').toLowerCase().includes('rice'))
console.log(`\nAbeokuta draft rows: ${abeokuta.length}`)
for (const [n, c] of nameCount) if (c > 1) console.log(` duplicate-name kept: "${n}" ×${c}`)
console.log('\nAbeokuta "Rice" cards:')
for (const r of rice) {
  console.log(` - [${r.name || '*'}] saved=${r.saved} price=${r.price ?? '—'} draft_price=${r.draft?.draft_price ?? '—'} entry=${r.draft?.entry_id ?? '—'}`)
}

// 3. Trailing draft:null group must hold only genuinely-orphaned items
const trailing = rows.filter((r) => !r.draft)
console.log(`\nTrailing "Saved items — no survey draft": ${trailing.length}`)
for (const t of trailing) console.log(` - [${t.name}] sku=${t.sku}`)
const itemIds = rows.map((r) => r.item_id).filter(Boolean)
const dupItemIds = itemIds.filter((v, i) => itemIds.indexOf(v) !== i)
console.log(`items appearing more than once anywhere: ${dupItemIds.length ? [...new Set(dupItemIds)].join(',') : 'none'}`)
console.log('\nVERDICT:', rice.length >= 2 ? 'FIX DEPLOYED AND WORKING (both Rice drafts visible)' : 'old behavior still deployed — host has not picked up dc74772 yet')
