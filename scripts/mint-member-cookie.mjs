// Mint a member_token cookie using the app's own signing module so the
// browser-style member flows can be driven headlessly. Usage:
//   node scripts/mint-member-cookie.mjs A20496
import fs from 'node:fs'
for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try { for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {}
}
const mid = String(process.argv[2] || '').toUpperCase()
if (!mid) { console.error('usage: node scripts/mint-member-cookie.mjs <MEMBER_ID>'); process.exit(1) }
const { sign } = await import('../lib/signingEdge.js')
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const m = (await c.query("SELECT member_id, full_name, branch_id FROM members WHERE member_id = $1", [mid])).rows[0]
const b = m?.branch_id ? (await c.query("SELECT code, name FROM branches WHERE id = $1", [m.branch_id])).rows[0] : null
await c.end()
const claims = { role: 'member', member_id: m.member_id, branch_id: m.branch_id ?? null, branch_code: b?.code || '', name: m.full_name || '' }
const token = await sign(claims, 60 * 60 * 8)
console.log('member_token=' + token)
