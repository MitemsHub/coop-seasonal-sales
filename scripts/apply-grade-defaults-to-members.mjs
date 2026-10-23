// Applies the current grade_limits defaults to every member of each grade —
// the one-time push the admin requested after editing Members → Global limits
// and not seeing member profiles change. Only grades whose default is > 0
// are pushed (Pensioner/Retiree/Undefined/Coop Staff/Deputy Governor carry 0
// and are deliberately left alone).
//
// Before writing it captures the previous value of every affected member row
// into a JSON backup so the push is reversible grade-for-grade.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

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

const grades = await c.query(`SELECT grade, global_limit FROM grade_limits WHERE global_limit > 0 ORDER BY grade`)
if (!grades.rows.length) { console.log('No positive grade defaults — nothing to push'); await c.end(); process.exit(0) }

// Pre-capture: every member in a pushed grade whose limit differs from the new default
const target = new Map(grades.rows.map((g) => [g.grade, Number(g.global_limit)]))
const before = await c.query(
  `SELECT m.member_id, m.grade, m.global_limit
   FROM members m JOIN UNNEST($1::text[], $2::bigint[]) AS g(grade, lim)
     ON m.grade = g.grade
   WHERE COALESCE(m.global_limit, 0) <> g.lim`,
  [[...target.keys()], [...target.values()]]
)
const affected = before.rows
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `scripts/grade-limits-push-backup-${stamp}.json`
fs.writeFileSync(backupPath, JSON.stringify({ at: new Date().toISOString(), affected }, null, 1))

let idx = 0
const perGrade = {}
const updated = await c.query(
  `WITH g AS (SELECT * FROM UNNEST($1::text[], $2::bigint[]) AS t(grade, lim))
   UPDATE members m SET global_limit = g.lim
   FROM g WHERE m.grade = g.grade AND COALESCE(m.global_limit, 0) <> g.lim
   RETURNING m.member_id, m.grade`,
  [[...target.keys()], [...target.values()]]
)
for (const r of updated.rows) {
  perGrade[r.grade] = (perGrade[r.grade] || 0) + 1
  idx++
}
console.log(`Updated ${idx} members across ${Object.keys(perGrade).length} grades:`)
for (const [g, n] of Object.entries(perGrade)) console.log(`  ${g}: ${n} members → ₦${target.get(g).toLocaleString()}`)
console.log(`Backup of previous values: ${backupPath} (${affected.length} rows)`)

// Verify: no member of a pushed grade should differ from its new default now
const check = await c.query(
  `SELECT m.grade, COUNT(*) AS n
   FROM members m JOIN UNNEST($1::text[], $2::bigint[]) AS g(grade, lim)
     ON m.grade = g.grade
   WHERE COALESCE(m.global_limit, 0) <> g.lim
   GROUP BY m.grade`,
  [[...target.keys()], [...target.values()]]
)
console.log('Remaining mismatches:', check.rows.length ? JSON.stringify(check.rows) : 'none')

await c.end()
console.log('DONE')
