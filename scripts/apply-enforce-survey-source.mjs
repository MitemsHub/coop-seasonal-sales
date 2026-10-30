// scripts/apply-enforce-survey-source.mjs
//
// Applies migrations/enforce-survey-linked-item-source.sql to the live
// database and proves it with two rolled-back test cases:
//
//   A. a general item with NO price rows (the exact state item #463 was in
//      when fix-soklin22g-twin.mjs linked survey entry 440 to it) — linking
//      a draft must flip it to 'outsourced';
//   B. a general item priced in EVERY branch (the state of the legitimate
//      general products #5 / #16 / #18, which surveys also link to) — linking
//      a draft must leave it 'general'.
//
// Everything test-side runs inside a transaction that is rolled back, so no
// data is left behind. The only permanent change is the DDL (function +
// trigger).
//
// Idempotent: re-running drops/recreates the trigger and replaces the
// function. Env: SUPABASE_DB_URL from .env.local / .env.local.remote / .env.
import fs from 'node:fs'

function loadEnv() {
  const out = {}
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {}
  }
  for (const [k, v] of Object.entries(out)) if (!(k in process.env)) process.env[k] = v
}
loadEnv()
if (!process.env.SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL not set (check .env.local / .env).')
  process.exit(1)
}

const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

let failures = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ── 1. Apply the migration ────────────────────────────────────────────────
console.log('1. apply migrations/enforce-survey-linked-item-source.sql')
const sql = fs.readFileSync('migrations/enforce-survey-linked-item-source.sql', 'utf8')
try {
  await c.query(sql)
  console.log('   applied')
} catch (e) {
  console.error('   FAILED:', e.message)
  process.exit(1)
}

const trig = await c.query(`
  SELECT tgname, tgenabled FROM pg_trigger
   WHERE tgname = 'trg_enforce_survey_linked_item_source' AND NOT tgisinternal`)
check(trig.rows.length === 1, 'trigger exists and is enabled', JSON.stringify(trig.rows[0] || null))

// ── 2. Behavioural proof (rolled back) ────────────────────────────────────
console.log('2. behaviour tests (transaction rolled back — no data kept)')
const branchCount = (await c.query('SELECT COUNT(*)::int n FROM branches')).rows[0].n
const activeCycle = (await c.query('SELECT id FROM cycles WHERE is_active LIMIT 1')).rows[0]?.id
const anySubmission = (await c.query('SELECT id FROM food_survey_submissions ORDER BY id LIMIT 1')).rows[0]?.id
console.log(`   branches=${branchCount} activeCycle=${activeCycle} sampleSubmission=${anySubmission}`)

try {
  await c.query('BEGIN')

  // A. unpriced general item (the #463-at-link-time state) → must flip.
  const a = await c.query(`
    INSERT INTO items (sku, name, unit, category, source)
    VALUES ('TRIGTESTUNPRICED', 'Trigger Test Unpriced', 'Carton', 'Detergent', 'general')
    RETURNING item_id, source`)
  const aId = a.rows[0].item_id
  await c.query(`
    INSERT INTO food_survey_entries (submission_id, item_name, category, price, cancelled, saved_item_id)
    VALUES ($1, 'trigger test draft', 'Detergent', 100, false, $2)`, [anySubmission, aId])
  const aAfter = await c.query('SELECT source FROM items WHERE item_id = $1', [aId])
  check(aAfter.rows[0].source === 'outsourced', 'A: unpriced general item flips to outsourced', aAfter.rows[0].source)

  // B. general item priced in EVERY branch → must stay general.
  const b = await c.query(`
    INSERT INTO items (sku, name, unit, category, source)
    VALUES ('TRIGTESTFULLPRICED', 'Trigger Test Full Priced', 'Carton', 'Detergent', 'general')
    RETURNING item_id, source`)
  const bId = b.rows[0].item_id
  await c.query(`
    INSERT INTO branch_item_prices (branch_id, item_id, cycle_id, price)
    SELECT id, $1, $2, 100 FROM branches`, [bId, activeCycle])
  const bPriced = (await c.query(
    'SELECT COUNT(DISTINCT branch_id)::int n FROM branch_item_prices WHERE item_id = $1', [bId])).rows[0].n
  check(bPriced === branchCount, 'B fixture priced in every branch', `${bPriced}/${branchCount}`)
  await c.query(`
    INSERT INTO food_survey_entries (submission_id, item_name, category, price, cancelled, saved_item_id)
    VALUES ($1, 'trigger test draft', 'Detergent', 100, false, $2)`, [anySubmission, bId])
  const bAfter = await c.query('SELECT source FROM items WHERE item_id = $1', [bId])
  check(bAfter.rows[0].source === 'general', 'B: fully-priced general item stays general', bAfter.rows[0].source)

  // C. real catalog rows a survey links to must be untouched (read-only here)
  const real = await c.query(`
    SELECT item_id, source FROM items WHERE item_id IN (5, 16, 18, 463) ORDER BY item_id`)
  console.log('   real rows in this snapshot:', JSON.stringify(real.rows))
  check(real.rows.find((r) => r.item_id === 463)?.source === 'outsourced', 'C: #463 is outsourced')
  check(real.rows.filter((r) => [5, 16, 18].includes(r.item_id)).every((r) => r.source === 'general'),
    'C: #5 / #16 / #18 stay general')

  await c.query('ROLLBACK')
  console.log('   rolled back')
} catch (e) {
  failures++
  console.error('   TEST FAILED:', e.message)
  try { await c.query('ROLLBACK') } catch {}
}

// ── 3. Live invariant after the rollback ──────────────────────────────────
console.log('3. live invariant (general + survey-linked + not priced everywhere)')
const leaks = await c.query(`
  SELECT i.item_id, i.name,
         (SELECT COUNT(DISTINCT p.branch_id)::int FROM branch_item_prices p
           WHERE p.item_id = i.item_id
             AND p.cycle_id = (SELECT id FROM cycles WHERE is_active LIMIT 1)) AS priced,
         (SELECT COUNT(*)::int FROM branches) AS total
    FROM items i
   WHERE COALESCE(i.source, 'general') = 'general'
     AND EXISTS (SELECT 1 FROM food_survey_entries e
                  WHERE e.saved_item_id = i.item_id AND NOT e.cancelled)
     AND (SELECT COUNT(DISTINCT p.branch_id)::int FROM branch_item_prices p
            WHERE p.item_id = i.item_id
              AND p.cycle_id = (SELECT id FROM cycles WHERE is_active LIMIT 1))
         < (SELECT COUNT(*)::int FROM branches)`)
check(leaks.rows.length === 0, 'no leaks remain', leaks.rows.length ? JSON.stringify(leaks.rows) : 'clean')

await c.end()
console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
