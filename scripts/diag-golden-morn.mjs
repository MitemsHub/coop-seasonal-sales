// READ-ONLY — diagnose why the saved item "Golden Morn 30g" lands in the
// trailing "Saved items — no survey draft" group (last branch page).
// Expected shape if healthy: a survey entry named ~"Golden Morn 30g" (or a
// leading/contained name variant) linked via saved_item_id to this item.
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

const q1 = await c.query(`
  SELECT item_id, sku, name, unit, category, is_active, source
  FROM items WHERE name ILIKE '%golden morn%' ORDER BY item_id`)
console.log('\n== items matching "golden morn" ==')
console.table(q1.rows)
const itemIds = q1.rows.map(r => r.item_id)

const qc = await c.query(`SELECT id, code, is_active, survey_open FROM cycles ORDER BY is_active DESC, id DESC LIMIT 5`)
console.log('\n== recent cycles (active first) ==')
console.table(qc.rows)
const activeCycle = qc.rows.find(r => r.is_active)?.id ?? null
console.log('active cycle id:', activeCycle)

const qOpts = await c.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'food_survey_entries' ORDER BY ordinal_position`)
console.log('\n== food_survey_entries columns ==')
console.table(qOpts.rows)

if (itemIds.length) {
  const q2 = await c.query(`
    SELECT b.id AS branch_id, b.name AS branch, p.cycle_id, p.price
    FROM branch_item_prices p JOIN branches b ON b.id = p.branch_id
    WHERE p.item_id = ANY($1) ORDER BY b.name, p.cycle_id`, [itemIds])
  const ek = q2.rows.filter(r => r.cycle_id === activeCycle).map(r => r.price)
  const cash = q2.rows.filter(r => r.cycle_id === activeCycle && Number(r.price) === 18450)
  if (cash.length) {
    const dup = ek.filter(p => Number(p) === 18450).length
    console.log(`\n== branch_item_prices at ₦18,450 in cycle ${activeCycle} ==`)
    console.table(cash)
    console.log(`(prices at 18450 in this cycle across these items: ${dup} of ${ek.length})`)
  }
  console.log('\n== branch_item_prices for golden morn ==')
  console.table(q2.rows)

  const q3 = await c.query(`
    SELECT e.id AS entry_id, e.saved_item_id, e.item_name AS draft_name, e.price AS draft_price,
           e.cancelled, s.id AS submission_id, s.cycle_id, s.branch_id, b.name AS branch,
           s.rep_name, e.created_at
    FROM food_survey_entries e
    JOIN food_survey_submissions s ON s.id = e.submission_id
    LEFT JOIN branches b ON b.id = s.branch_id
    ${activeCycle ? 'WHERE s.cycle_id = $1 AND' : 'WHERE'}
      (e.saved_item_id = ANY($2) OR e.item_name ILIKE '%morn%' OR lower(e.item_name) LIKE '%golden morn%')
    ORDER BY b.name, e.created_at`, activeCycle ? [activeCycle, itemIds] : [itemIds])
  console.log('\n== golden-morn survey entries in the active cycle ==')
  console.table(q3.rows)
}

// Also: every draft in the active cycle whose saved_item_id IS NULL and whose
// name looks like a cereal — to spot the unlinked sibling.
if (activeCycle && itemIds.length) {
  const q4 = await c.query(`
    SELECT e.id AS entry_id, e.item_name, e.price AS draft_price, e.cancelled, e.saved_item_id,
           b.name AS branch, s.rep_name, e.created_at
    FROM food_survey_entries e
    JOIN food_survey_submissions s ON s.id = e.submission_id
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE s.cycle_id = $1
    ORDER BY e.created_at DESC
    LIMIT 40`, [activeCycle])
  console.log('\n== LAST 40 entries in the active cycle (any item) ==')
  console.table(q4.rows)
}

await c.end()
console.log('DONE (read-only)')
