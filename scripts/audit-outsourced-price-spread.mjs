// Audit: flag OUTSOURCED items priced in more branches than they have real saves.
//
// The Fresh Red Oil 5L damage signature (2026-10-20): the price-only recovery
// wrote ₦14,500 price rows for item #3 into 38 branches whose reps never
// submitted it, while only ONE branch's draft was genuinely linked. The
// General×Outsourced decoupling killed the top cause, but any future
// "save broadcasts everywhere" bug or stray import can recreate the shape.
//
// Ground rule for outsourced items: a branch's price row is legitimate only
// when (a) some survey entry from THAT branch links to the item (saved_item_id
// rounded), or (b) the item is legacy/cycle-1 history we don't re-litigate.
// The audit compares, per outsourced item and per ACTIVE cycle:
//   pricedBranches  — distinct branches with a >0 price row in the cycle
//   savedBranches   — distinct branches with a non-cancelled survey entry
//                     linked to the item in that cycle
// and flags pricedBranches > savedBranches (strictly), listing the branches
// priced without a real save.
//
// Exit code: 0 = clean, 1 = findings (so a cron can alert on non-zero).
// Read-only: SELECTs only.
import 'dotenv/config'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const { default: fs } = await import('node:fs')
      const txt = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('No SUPABASE_DB_URL found (.env.local / .env.local.remote)')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows

// Active cycles only — historical cycles are not actionable.
const cycles = await q(`SELECT id, name FROM cycles WHERE is_active = TRUE ORDER BY id`)
if (!cycles.length) { console.error('No active cycle found.'); process.exit(0) }

let findings = 0
for (const cy of cycles) {
  // Per outsourced item: branches with a real price in this cycle
  const priced = await q(`
    SELECT p.item_id, i.sku, i.name, COUNT(DISTINCT p.branch_id) AS priced_branches,
           array_agg(DISTINCT p.branch_id ORDER BY p.branch_id) AS priced_ids
    FROM branch_item_prices p
    JOIN items i ON i.item_id = p.item_id AND i.source = 'outsourced'
    WHERE p.cycle_id = $1 AND p.price > 0
    GROUP BY p.item_id, i.sku, i.name
    ORDER BY priced_branches DESC`, [cy.id])

  if (!priced.length) continue

  // Per outsourced item: branches whose reps genuinely have a linked, live
  // survey entry (saved_item_id = item, not cancelled), resolved the same way
  // the Items Import API does it: the submission's cycle matches the active
  // cycle OR the submission carries cycle_id NULL (perpetual survey rows that
  // count for every cycle) — an exact cycle_id match alone would blind the
  // audit to how the app actually treats NULL-cycle submissions.
  const saved = await q(`
    SELECT e.saved_item_id AS item_id,
           array_agg(DISTINCT s.branch_id ORDER BY s.branch_id) AS saved_ids
    FROM food_survey_entries e
    JOIN food_survey_submissions s ON s.id = e.submission_id
    WHERE e.saved_item_id IS NOT NULL AND e.cancelled IS NOT TRUE
      AND (s.cycle_id = $1 OR s.cycle_id IS NULL)
    GROUP BY e.saved_item_id`, [cy.id])
  // KEY NORMALISATION: e.saved_item_id is BIGINT → node-pg returns it as a
  // STRING ('12'), while p.item_id is INTEGER → a NUMBER (12). Without
  // normalising, Map.get(12) misses the '12' key and every item looks
  // link-less — the "100 info rows" false positive on the first run.
  const savedByItem = new Map(saved.map((r) => [Number(r.item_id), r.saved_ids]))

  const branchNames = await q(`SELECT id, name, code FROM branches`)
  const nameOf = new Map(branchNames.map((b) => [b.id, `${b.name} (${b.code || b.id})`]))

  let suspectCount = 0
  for (const it of priced) {
    const savedIds = savedByItem.get(it.item_id) || []
    if (it.priced_branches <= savedIds.length) continue // legit or better
    const extra = it.priced_ids.filter((id) => !savedIds.includes(id))
    const label = (id) => nameOf.get(id) || String(id)
    if (savedIds.length === 0) {
      // NO link evidence at all — usually a legit Excel-import history or a
      // pre-saved bank item (every #3xx item is like this), not the recovery
      // bug. Info only; never inflates the failed count.
      console.log(`ℹ cycle ${cy.id} item #${it.item_id} [${it.name}] sku=${it.sku} — priced in ${it.priced_branches} branches with NO linked survey entries. Usually a legit import history; only investigate if no save/import ever targeted these branches.`)
    } else {
      // Mixed picture — but before flagging, check the price VALUES. The
      // Excel importer wrote ONE uniform price into many branches (that's
      // how #5 got 39×₦18,800) while the hijack always left the real save's
      // branch diverging. If only one distinct price exists across all
      // priced rows, treat it as import history and stay silent.
      const distinctPrices = await q(
        `SELECT COUNT(DISTINCT price) AS n FROM branch_item_prices WHERE item_id = $1 AND cycle_id = $2 AND price > 0`,
        [it.item_id, cy.id]
      )
      if (Number(distinctPrices[0]?.n) === 1) {
        const only = await q(
          `SELECT DISTINCT price FROM branch_item_prices WHERE item_id = $1 AND cycle_id = $2 AND price > 0 LIMIT 1`,
          [it.item_id, cy.id]
        )
        console.log(`ℹ cycle ${cy.id} item #${it.item_id} [${it.name}] sku=${it.sku} — priced uniformly (₦${Number(only[0]?.price || 0).toLocaleString()}) in ${it.priced_branches} branches though only ${savedIds.length} branch(es) have linked saves; single price across all rows = import history, not the hijack shape.`)
      } else {
        // Mixed prices AND mixed links — the actual hijack shape.
        suspectCount += 1
        console.log(`⚑ cycle ${cy.id} item #${it.item_id} [${it.name}] sku=${it.sku}`)
        console.log(`   priced in ${it.priced_branches} branches, real saves in ${savedIds.length}`)
        console.log(`   priced WITHOUT a real save: ${extra.map((id) => label(id)).join(', ')}`)
        console.log(`   → repair: delete those price rows or link/cancel the drafts; they pollute the shop.`)
      }
    }
  }
  findings += suspectCount
}

console.log(findings === 0
  ? `✔ No mixed-price-spread hijacks found — every outsourced item's priced branches are backed by real linked saves.`
  : `✖ ${findings} outsourced item(s) priced in branches with no real save (mixed-spread hijack shape).`)
await client.end()
process.exit(findings === 0 ? 0 : 1)
