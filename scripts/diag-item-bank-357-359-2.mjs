import pg from 'pg'
import fs from 'fs'

let url = process.env.SUPABASE_DB_URL
if (!url) {
  for (const f of ['.env.local', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { url = m[1].trim().replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

const cycles = await c.query(`SELECT id, is_active FROM cycles ORDER BY id DESC LIMIT 5`)
console.log('== cycles ==')
console.table(cycles.rows)

const map = await c.query(`SELECT id, code FROM branches ORDER BY id`)
const codes = Object.fromEntries(map.rows.map(r => [Number(r.id), r.code]))

const priced = await c.query(
  `SELECT item_id, branch_id, price, cycle_id FROM branch_item_prices WHERE item_id IN (357,359) ORDER BY item_id, branch_id`
)
const ovr = await c.query(
  `SELECT item_id, branch_id, name FROM item_branch_overrides WHERE item_id IN (357,359) ORDER BY item_id, branch_id`
)
const ovrSet = new Set(ovr.rows.map(r => `${r.item_id}:${r.branch_id}`))
console.log('== priced branches (item:branch:price cycle) — override? ==')
for (const r of priced.rows) {
  const has = ovrSet.has(`${r.item_id}:${r.branch_id}`)
  console.log(`item ${r.item_id} → ${(codes[Number(r.branch_id)] || r.branch_id).padEnd(10)} price ${r.price} cycle ${r.cycle_id} ${has ? 'override ✓' : 'override ✗ MISSING'}`)
}
await c.end()
