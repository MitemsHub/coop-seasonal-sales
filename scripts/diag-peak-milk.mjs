import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Diagnose the Peak Milk Full Cream item picture:
//   • every items row matching Peak Milk (active or not)
//   • every branch that prices either variant, per cycle
//   • survey entries that resolve to them
// Read-only.
const p = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, max: 1 })
try {
  const items = await p.query(`
    SELECT i.item_id, i.sku, i.name, i.category, i.unit, i.is_active, i.source
    FROM items i
    WHERE i.name ILIKE '%peak%' OR i.sku ILIKE '%PEAKMILK%'
    ORDER BY i.item_id`)
  console.log('=== ITEMS matching Peak ===')
  for (const r of items.rows) console.log(JSON.stringify(r))

  const ids = items.rows.map(r => r.item_id)
  if (ids.length) {
    const prices = await p.query(`
      SELECT p.item_id, b.name AS branch, b.code AS branch_code, p.cycle_id, p.price, p.id AS price_id
      FROM branch_item_prices p JOIN branches b ON b.id = p.branch_id
      WHERE p.item_id = ANY($1::bigint[])
      ORDER BY p.cycle_id DESC, b.name, p.item_id`, [ids])
    console.log('\n=== BRANCH PRICES ===')
    for (const r of prices.rows) console.log(`${r.cycle_id} | ${r.branch} (${r.branch_code}) | item ${r.item_id} | ₦${r.price} | price_id ${r.price_id}`)

    const markups = await p.query(`
      SELECT m.item_id, b.name AS branch, m.cycle_id, m.amount, m.active
      FROM branch_item_markups m JOIN branches b ON b.id = m.branch_id
      WHERE m.item_id = ANY($1::bigint[])
      ORDER BY b.name`, [ids])
    console.log('\n=== MARKUPS ===')
    for (const r of markups.rows) console.log(JSON.stringify(r))

    const entries = await p.query(`
      SELECT e.id, e.item_name, e.category, e.price, e.saved_item_id, e.cancelled,
             s.branch_id, b.name AS branch, s.cycle_id, s.rep_name
      FROM food_survey_entries e
      LEFT JOIN food_survey_submissions s ON s.id = e.submission_id
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE e.saved_item_id = ANY($1::bigint[]) OR e.item_name ILIKE '%peak milk%'
      ORDER BY e.id`, [ids])
    console.log('\n=== SURVEY ENTRIES ===')
    for (const r of entries.rows) console.log(JSON.stringify(r))

    const branchesWithPeak = await p.query(`
      SELECT DISTINCT b.name AS branch, b.code AS branch_code, p.item_id, i.name AS item_name, p.cycle_id
      FROM branch_item_prices p
      JOIN branches b ON b.id = p.branch_id
      JOIN items i ON i.item_id = p.item_id
      WHERE p.item_id = ANY($1::bigint[])
      ORDER BY b.name`, [ids])
    console.log('\n=== UNIQUE (branch, item, cycle) ===')
    for (const r of branchesWithPeak.rows) console.log(`${r.branch} (${r.branch_code}) | ${r.item_name} | cycle ${r.cycle_id}`)
  }

  const branches = await p.query(`SELECT id, name, code FROM branches WHERE name ILIKE '%markurdi%' OR name ILIKE '%makurdi%'`)
  console.log('\n=== BRANCH match Makurdi ===')
  for (const r of branches.rows) console.log(JSON.stringify(r))
} catch (e) { console.log('ERROR', e.message); process.exitCode = 1 }
finally { await p.end() }
