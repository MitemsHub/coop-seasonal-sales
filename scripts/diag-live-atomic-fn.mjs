// READ-ONLY — dump the LIVE definition of create_food_order_atomic
// (the server-side loan gate) so changes can be mirrored against reality.
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

const list = await c.query(`
  SELECT p.oid::regprocedure AS signature, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_food_order_atomic'`)
console.log('== signatures ==')
for (const r of list.rows) console.log(r.signature)

const def = await c.query(`
  SELECT pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_food_order_atomic'`)
for (const r of def.rows) {
  console.log('\n========== LIVE create_food_order_atomic ==========')
  fs.writeFileSync('scripts/live-create_food_order_atomic.sql.txt', r.def)
  console.log('definition written to scripts/live-create_food_order_atomic.sql.txt')
  // print the eligibility-relevant slice
  const lines = r.def.split('\n')
  let inElig = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/v_member_savings|v_raw_loan_limit|v_effective_limit|v_base_eligible|v_outstanding|grace|cap|retiree|pensioner|category/.test(l)) {
      console.log(String(i + 1).padStart(4), l)
    }
  }
}

// Does the function read per-group caps by category code?
const cats = await c.query(`SELECT pg_get_functiondef(p.oid) AS d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='create_food_order_atomic'`)
for (const r of cats.rows) {
  const usesCategory = /member_category/.test(r.d)
  console.log('\nreferences p_member_category:', usesCategory)
}

await c.end()
console.log('DONE (read-only)')
