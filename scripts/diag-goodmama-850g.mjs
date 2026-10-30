// Diagnostic: why does "Good Mama 850G" (#161) show under
// "Saved items — no survey draft" on the Items Import page's last page?
//
// Prints: the item, its pricing scope, its overrides, order history, and the
// survey entries that name-match it (linked or not) so the missing link — if
// that is what it is — is obvious. Read-only; writes nothing.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try {
    const txt = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
    if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
  } catch {}
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows

const ITEM = Number(process.argv.find((a) => /^\d+$/.test(a)) || 161)

const cycles = await q('SELECT * FROM cycles ORDER BY id')
const active = cycles.find((c) => c.is_active) || cycles[cycles.length - 1]
console.log('cycles:', cycles.map((c) => `#${c.id}${c.is_active ? ' (active)' : ''}`).join(', '))
console.log(`active cycle: #${active?.id}\n`)

const [item] = await q('SELECT * FROM items WHERE item_id = $1', [ITEM])
console.log('ITEM:', JSON.stringify({
  item_id: item?.item_id, sku: item?.sku, name: item?.name, category: item?.category,
  unit: item?.unit, source: item?.source, is_active: item?.is_active,
}, null, 1))

const total = (await q('SELECT COUNT(*)::int n FROM branches'))[0].n
const prices = await q(`
  SELECT bip.cycle_id, b.code, bip.price
  FROM branch_item_prices bip JOIN branches b ON b.id = bip.branch_id
  WHERE bip.item_id = $1 ORDER BY bip.cycle_id, b.code`, [ITEM])
console.log(`\nPRICES (${prices.length} rows, ${total} branches exist):`)
for (const p of prices) console.log(`  cycle ${p.cycle_id} · ${p.code} · ${p.price}`)

const links = await q(`
  SELECT e.id, e.item_name, e.price, e.cancelled, e.submission_id,
         s.cycle_id, b.code AS branch, e.saved_item_id
  FROM food_survey_entries e
  JOIN food_survey_submissions s ON s.id = e.submission_id
  JOIN branches b ON b.id = s.branch_id
  WHERE e.saved_item_id = $1`, [ITEM])
console.log('\nSURVEY ENTRIES LINKED TO IT:', JSON.stringify(links, null, 1) || 'none')

const ovs = await q('SELECT * FROM item_branch_overrides WHERE item_id = $1', [ITEM])
console.log('OVERRIDES:', JSON.stringify(ovs.map((o) => ({ id: o.id, branch_id: o.branch_id, display_name: o.display_name })), null, 1))

const ol = (await q('SELECT COUNT(*)::int n FROM order_lines WHERE item_id = $1', [ITEM]))[0].n
console.log('ORDER LINES:', ol)

// Name-similar survey entries anywhere (linked elsewhere or unlinked).
const names = await q(`
  SELECT e.id, e.item_name, e.price, e.cancelled, e.saved_item_id,
         (SELECT name FROM items WHERE item_id = e.saved_item_id) AS linked_item,
         b.code AS branch, s.cycle_id
  FROM food_survey_entries e
  JOIN food_survey_submissions s ON s.id = e.submission_id
  JOIN branches b ON b.id = s.branch_id
  WHERE e.item_name ILIKE '%good mama%850%' OR e.item_name ILIKE '%goodmama%850%'
  ORDER BY e.id`)
console.log('\nNAME-MATCHING SURVEY ENTRIES (850g):', JSON.stringify(names, null, 1))

// Same, but for the branches that price it — an unlinked draft from that branch.
const pricedBranches = [...new Set(prices.map((p) => p.code))]
if (pricedBranches.length) {
  const byBranch = await q(`
    SELECT e.id, e.item_name, e.price, e.cancelled, e.saved_item_id, b.code AS branch, s.cycle_id
    FROM food_survey_entries e
    JOIN food_survey_submissions s ON s.id = e.submission_id
    JOIN branches b ON b.id = s.branch_id
    WHERE b.code = ANY($1) AND e.saved_item_id IS NULL
      AND (e.item_name ILIKE '%good mama%' OR e.item_name ILIKE '%mama%')
    ORDER BY e.id`, [pricedBranches])
  console.log('\nUNLINKED drafts in the pricing branch(es) naming "mama":', JSON.stringify(byBranch, null, 1))
}

await client.end()
