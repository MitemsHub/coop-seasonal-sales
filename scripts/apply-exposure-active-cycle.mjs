// One-off policy change (2026-10-24): cross-module exposure (Food +
// Exhibition) now counts ONLY purchases in the ACTIVE CYCLE, not the whole
// calendar year. Applies to the two live SQL functions that compute it:
//   - create_food_order_atomic          (Food order creation)
//   - check_exhibition_exposure_atomic  (Exhibition order eligibility check)
// Both currently sum orders WHERE created_at >= date_trunc('year', NOW());
// this replaces that filter with cycle_id = (active cycle) inside the
// exposure SELECT only (both subqueries per function). RAM's
// check_ram_exposure_atomic is already cycle-scoped and is left untouched.
// Mirrors lib/crossModuleExposure.js which is changed the same way.
//
// Idempotent: re-running replaces with the same definition.
// Usage: node scripts/apply-exposure-active-cycle.mjs [--dry]
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry')

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

const CYCLE_FILTER = `AND cycle_id = (SELECT id FROM cycles WHERE is_active ORDER BY id DESC LIMIT 1)`
const YEAR_FILTER = `AND created_at >= v_year_start`

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync('scripts/exposure-fn-backups', { recursive: true })

let applied = false
for (const name of ['create_food_order_atomic', 'check_exhibition_exposure_atomic']) {
  const defs = await c.query(
    `SELECT oid::regprocedure::text AS sig, pg_get_functiondef(oid) AS d
       FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [name])
  for (const row of defs.rows) {
    const def = row.d
    const start = def.indexOf('SELECT COALESCE(SUM(CASE WHEN payment_option')
    if (start < 0) { console.error(`${row.sig}: exposure SELECT not found, skipping`); continue }
    const endMarker = 'combined;'
    const end = def.indexOf(endMarker, start)
    if (end < 0) { console.error(`${row.sig}: exposure block end not found, skipping`); continue }
    const block = def.slice(start, end + endMarker.length)

    const alreadyCycle = block.includes(CYCLE_FILTER)
    const yearCount = block.split(YEAR_FILTER).length - 1
    console.log(`\n===== ${row.sig}`)
    if (alreadyCycle) { console.log('already cycle-scoped — no change'); continue }
    if (yearCount !== 2) {
      console.error(`unexpected exposure block (${yearCount} year filters, excerpt):\n${block}`)
      process.exit(1)
    }
    const newBlock = block.split(YEAR_FILTER).join(CYCLE_FILTER)
    const newDef = def.slice(0, start) + newBlock + def.slice(end + endMarker.length)

    const backupPath = `scripts/exposure-fn-backups/${row.sig.replace(/[^\w]+/g, '_')}-${stamp}.sql`
    fs.writeFileSync(backupPath, def)
    console.log(`backup: ${backupPath}`)

    if (DRY) { console.log('--dry: would apply. New block:\n' + newBlock); continue }

    await c.query(newDef)
    const after = await c.query(`SELECT pg_get_functiondef($1::regprocedure) AS d`, [row.sig])
    const afterDef = after.rows[0].d
    const aStart = afterDef.indexOf('SELECT COALESCE(SUM(CASE WHEN payment_option');
    const aEnd = afterDef.indexOf('combined;', aStart) + 'combined;'.length
    const ok = afterDef.includes(CYCLE_FILTER) && !afterDef.slice(aStart, aEnd).includes(YEAR_FILTER)
    console.log(ok ? 'applied and verified ✓' : 'APPLIED BUT VERIFY FAILED ✗')
    applied = true
  }
}
if (DRY) console.log('\n--dry done')
else console.log(applied ? '\nall done' : '\nnothing needed changes')
await c.end()
