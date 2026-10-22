import fs from 'node:fs'
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {}
}
const BASE = 'http://localhost:3002'
const c = new (await import('pg')).default.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const cycle = (await c.query('SELECT id, starts_at, ends_at FROM cycles WHERE is_active = true')).rows[0]
const original = [cycle.starts_at, cycle.ends_at]
const member = (await c.query("SELECT member_id, savings FROM members WHERE loans > 1000 AND savings > 800000 AND email IS NOT NULL AND email <> '' ORDER BY member_id LIMIT 1")).rows[0]
await c.query("UPDATE cycles SET starts_at = now() - interval '1 day', ends_at = now() + interval '7 days' WHERE id = $1", [cycle.id])
console.log('member:', member.member_id, 'savings:', member.savings)

let orderId = null
try {
  const payload = { memberId: member.member_id, deliveryBranchCode: 'ABAKALIKI', departmentName: 'Banking Services Department', paymentOption: 'Loan', lines: [{ sku: 'ABAKALIKIRICE25KG', qty: 1 }] }
  const r = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, referer: BASE + '/' }, body: JSON.stringify(payload) })
  const j = await r.json()
  console.log('loan POST ->', r.status, JSON.stringify(j).slice(0, 220))
  orderId = j.order_id ?? null
  if (orderId) {
    const inv = await (await fetch(`${BASE}/api/orders/${encodeURIComponent(orderId)}`, { headers: { origin: BASE } })).json()
    console.log('invoice contains id:', JSON.stringify(inv).includes(String(orderId)), '| ok:', inv.ok, '| lines:', (inv.order?.order_lines || []).length, JSON.stringify(inv.order?.order_lines || []).slice(0, 200))
    const dup = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, referer: BASE + '/' }, body: JSON.stringify(payload) })
    const dj = await dup.json()
    console.log('duplicate POST ->', dup.status, JSON.stringify(dj).slice(0, 120))
  }
} finally {
  if (orderId) {
    // pg rejects multiple commands in one parameterized query — split them
    await c.query('DELETE FROM order_lines WHERE order_id = $1', [orderId])
    await c.query('DELETE FROM orders WHERE order_id = $1', [orderId])
  }
  await c.query('UPDATE cycles SET starts_at = $2, ends_at = $3 WHERE id = $1', [cycle.id, original[0], original[1]])
  await c.end()
}
