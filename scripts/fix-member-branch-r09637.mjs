// One-off: give member R09637 their home branch so checkout can submit.
//
// What broke (2026-10-28): POST /api/orders passes members.branch_id straight
// into create_food_order_atomic, which inserts orders.branch_id — a NOT NULL
// column. R09637 had branch_id NULL (home branch is only ever set by the Shop
// page's branch selector or /api/members/update-branch, which this member never
// used), so the insert died with:
//   null value in column "branch_id" of relation "orders" violates not-null
//   constraint
//
// Target branch: COOP_SECRETARIAT (id 5) — the member's department is
// department_id 1 = 'Coop Secretariat', their checkout delivery branch was
// 'COOP_SECRETARIAT', and every recent order has branch_id = delivery_branch_id.
//
// Usage: node scripts/fix-member-branch-r09637.mjs [--dry]
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const MEMBER = 'R09637'
const BRANCH_CODE = 'COOP_SECRETARIAT'

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

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const member = await c.query(`
  SELECT m.member_id, m.full_name, m.branch_id, m.department_id,
         b.code AS current_branch_code, d.name AS department
  FROM members m
  LEFT JOIN branches b ON b.id = m.branch_id
  LEFT JOIN departments d ON d.id = m.department_id
  WHERE m.member_id = $1`, [MEMBER])
if (!member.rows.length) { console.error(`Member ${MEMBER} not found.`); await c.end(); process.exit(1) }

const branch = await c.query(`SELECT id, code, name FROM branches WHERE code = $1`, [BRANCH_CODE])
if (!branch.rows.length) { console.error(`Branch ${BRANCH_CODE} not found.`); await c.end(); process.exit(1) }

console.log('Before:')
console.table(member.rows)
console.log('Target branch:')
console.table(branch.rows)

const cur = member.rows[0]
if (cur.branch_id != null) {
  console.log(`\nMember already has branch_id ${cur.branch_id} (${cur.current_branch_code}) — nothing to do.`)
  await c.end(); process.exit(0)
}
if (DRY) { console.log(`\n--dry: would set ${MEMBER}.branch_id = ${branch.rows[0].id} (${branch.rows[0].name})`); await c.end(); process.exit(0) }

await c.query(`UPDATE members SET branch_id = $1 WHERE member_id = $2 AND branch_id IS NULL`, [branch.rows[0].id, MEMBER])

const after = await c.query(`
  SELECT m.member_id, m.full_name, m.branch_id, b.code, b.name AS branch, m.department_id, d.name AS department
  FROM members m
  JOIN branches b ON b.id = m.branch_id
  LEFT JOIN departments d ON d.id = m.department_id
  WHERE m.member_id = $1`, [MEMBER])
console.log('\nAfter:')
console.table(after.rows)

const still = await c.query(`SELECT count(*)::int n FROM members WHERE member_id = $1 AND branch_id IS NULL`, [MEMBER])
console.log('Still branchless:', still.rows[0].n)

await c.end()
console.log('\nDone. The member can submit again — no cache to bust (members are read per request).')