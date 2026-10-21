// READ-ONLY — verify through the ADMIN API on prod what the changes look
// like in the real UI: item #5's shop-preview card (origin/image) and the
// Abuja/Head Office outsourced tabs after the replication.
import fs from 'node:fs'

const BASE = process.env.PROD_BASE_URL || 'https://sales.cbncoopng.com'
let passcode
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try {
    const txt = fs.readFileSync(f, 'utf8')
    const m = txt.match(/^ADMIN_PASSCODE=(.*)$/m)
    if (m) { passcode = m[1].trim().replace(/^["']|["']$/g, ''); break }
  } catch {}
}
if (!passcode) { console.error('No ADMIN_PASSCODE'); process.exit(1) }

const login = await fetch(`${BASE}/api/admin/pin/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passcode }),
})
if (!login.ok) { console.error('login failed', login.status); process.exit(1) }
const cookie = `admin_token=${/admin_token=([^;]+)/.exec(login.headers.get('set-cookie') || '')?.[1] || ''}`
const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { cookie } })
  return { status: r.status, j: await r.json().catch(() => ({})) }
}

// 1. Shop preview — Abuja Branch (#37): find SPAGHETTIGP card
const prev = await get('/api/admin/items?section=shop_preview&cycle_id=3&branch_id=37')
const spag = (prev.j.items || []).find((i) => i.sku === 'SPAGHETTIGP')
console.log('Abuja shop preview:', prev.status, `total ${prev.j.total}`)
console.log('  SPAGHETTIGP card:', spag ? JSON.stringify(spag) : 'NOT FOUND')
console.log(`  rep number of outsourced-origin cards: ${(prev.j.items || []).filter((i) => i.origin === 'outsourced').length}`)

// 2. Same for Head Office (#39)
const prevHO = await get('/api/admin/items?section=shop_preview&cycle_id=3&branch_id=39')
const spagHO = (prevHO.j.items || []).find((i) => i.sku === 'SPAGHETTIGP')
console.log('Head Office shop preview:', prevHO.status, `total ${prevHO.j.total}`)
console.log('  SPAGHETTIGP card:', spagHO ? JSON.stringify(spagHO) : 'NOT FOUND')

// 3. Outsourced tab — Head Office should now list the replicated products
const outs = await get('/api/admin/items?section=outsourced&cycle_id=3')
const rows = outs.j.rows || outs.j.items || []
const hoRows = rows.filter((r) => r.draft?.branch_id === 39)
const abRows = rows.filter((r) => r.draft?.branch_id === 37)
console.log(`\nOutsourced tab: ${outs.status}, rows ${rows.length}`)
console.log(`  Abuja draft cards: ${abRows.length} (saved: ${abRows.filter((r) => r.saved).length})`)
console.log(`  Head Office draft cards: ${hoRows.length} (saved: ${hoRows.filter((r) => r.saved).length})`)
const sample = hoRows.slice(0, 4).map((r) => `${r.name} — saved=${r.saved} price=${r.price ?? '—'} #${r.item_id ?? ''}`)
for (const s of sample) console.log('   ·', s)

// 4. Member-facing price API for Abuja (public)
const pub = await fetch(`${BASE}/api/items/prices?branch=ABUJA`)
const pubJ = await pub.json().catch(() => ([]))
const items = Array.isArray(pubJ) ? pubJ : pubJ.items || []
const pubSpag = items.find((i) => i.sku === 'SPAGHETTIGP')
const pubKings = items.find((i) => i.sku === 'KINGS5L')
console.log(`\nPublic /api/items/prices?branch=ABUJA: ${pub.status}, items ${items.length}`)
console.log('  SPAGHETTIGP:', pubSpag ? JSON.stringify(pubSpag) : 'MISSING')
console.log('  KINGS5L (replicated):', pubKings ? `${pubKings.name} ₦${pubKings.price}` : 'MISSING')
