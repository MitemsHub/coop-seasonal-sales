// Verify the deployed build carries commit ac07f6d's fixes:
//   Enugu Fresh Red Oil → saved + in_shop, exactly 1 branch, sku FRESHREDOIL5L
//   Semovita 1Kg (#361) → general row priced in all 39 branches
// Read-only: one login POST + GETs.
const BASE = 'https://sales.cbncoopng.com'
const fs = await import('node:fs')
const pc = (fs.readFileSync('.env.local', 'utf8').match(/^ADMIN_PASSCODE=(.*)$/m) || [])[1]
  ?.trim().replace(/^["']/g, '').replace(/["']$/g, '')

const login = await fetch(`${BASE}/api/admin/pin/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ passcode: pc }),
})
const setCookie = login.headers.get('set-cookie') || ''
const token = /admin_token=([^;]+)/.exec(setCookie)?.[1]
if (!token) { console.error('login failed'); process.exit(1) }
const cookie = `admin_token=${token}`
const get = async (p) => (await (await fetch(BASE + p, { headers: { cookie } })).json())

const j = await get('/api/admin/items?section=outsourced&cycle_id=3')
const enn = (j.rows || []).filter((r) => r.draft?.branch_name === 'Enugu')
console.log('Enugu rows:', enn.length)
const f = enn.find((r) => /red oil/i.test(r.name || r.draft?.draft_name || ''))
console.log('Enugu Fresh Red Oil:', JSON.stringify(f ? { name: f.name, sku: f.sku, saved: f.saved, in_shop: f.in_shop, price: f.price, branches: f.branches_priced } : null))

const g = await get('/api/admin/items?section=general&cycle_id=3')
const s = (g.rows || []).find((r) => r.item_id === 361)
console.log('Semovita 1Kg general:', JSON.stringify(s ? { sku: s.sku, branches_priced: s.branches_priced, in_shop: s.in_shop, price: s.price } : null))
