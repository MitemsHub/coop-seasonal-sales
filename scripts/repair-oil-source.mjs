// REPAIR: Fresh Red Oil 5L (item #360) belongs to the OUTSOURCED section, not
// General Items.
//
// Why it drifted: the item row was rebuilt during the 2026-10-30 identity
// repair (the cycle-1 row that had been renamed away from "Golden Penny
// Semovita 1Kg" was split so this cycle's Enugu oil sales got their own row).
// The new row inherited the default items.source = 'general', so the Items
// Import page started listing a rep-survey product under "General Items —
// added once, priced in every branch", even though it is priced in exactly one
// branch (the branch whose rep surveyed it).
//
// Evidence that it is an Outsourced product:
//   * food_survey_entries #504 "Fresh Red oil 5 litres" (₦14,500, not
//     cancelled) has saved_item_id = 360 — it is a rep survey draft.
//   * that entry belongs to submission 28: branch ENUGU, cycle 3 (active).
//   * branch_item_prices holds exactly ONE row for it this cycle: ENUGU.
//     Genuine General items are priced in all 39 branches.
//
// The repair is a one-column flip: items.source. Nothing about the item's
// identity (name/unit/category/image) changes, so no receipt is touched and
// the freeze trigger is not involved. The shop reads branch_item_prices, not
// source, so members see the same product in the same Enugu shop afterwards —
// it simply moves from the General list to the Outsourced list, where the
// linked survey card already says "✓ Worked on · in shop".
//
// APPLY: node scripts/repair-oil-source.mjs --write   (default is dry-run)

import 'dotenv/config'
import pg from 'pg'

for (const f of ['.env.local', '.env.local.remote', '.env']) {
  try {
    const { default: fs } = await import('node:fs')
    const txt = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
    if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
  } catch {}
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('No SUPABASE_DB_URL found')
  process.exit(1)
}

const WRITE = process.argv.includes('--write')
console.log(WRITE ? 'MODE: WRITE — the change IS applied.\n' : 'MODE: DRY-RUN — no writes. Re-run with --write to apply.\n')

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const q = async (sql, params = []) => (await client.query(sql, params)).rows

const ITEM = 360
let failures = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ── 1. The item itself ─────────────────────────────────────────────────────
console.log('1. item #360')
const [item] = await q(`SELECT item_id, name, sku, source, is_active FROM items WHERE item_id = $1`, [ITEM])
check(Boolean(item), 'row exists', item ? `${item.name} / ${item.sku}` : 'missing')

// ── 2. Survey proof ────────────────────────────────────────────────────────
console.log('2. survey proof (this is what makes it Outsourced)')
const links = await q(`
  SELECT e.id, e.item_name, e.price, e.cancelled, s.cycle_id, b.code AS branch
  FROM food_survey_entries e
  JOIN food_survey_submissions s ON s.id = e.submission_id
  JOIN branches b ON b.id = s.branch_id
  WHERE e.saved_item_id = $1`, [ITEM])
check(links.length > 0, 'a rep survey entry points at this item', `${links.length} entr(ies)`)
for (const l of links) {
  console.log(`       entry #${l.id} "${l.item_name}" ₦${l.price} · branch ${l.branch} · cycle ${l.cycle_id} · cancelled=${l.cancelled}`)
}
const activeLink = links.find((l) => !l.cancelled)

// ── 3. Branch scoping proof (General = priced in every branch) ─────────────
console.log('3. pricing scope')
const scope = await q(`
  SELECT COUNT(*)::int AS price_rows, COUNT(DISTINCT branch_id)::int AS branches,
         string_agg(DISTINCT b.code, ',') AS which
  FROM branch_item_prices bip JOIN branches b ON b.id = bip.branch_id
  WHERE bip.item_id = $1 AND bip.cycle_id = (SELECT id FROM cycles WHERE is_active LIMIT 1)`, [ITEM])
const s = scope[0] || {}
console.log(`       priced in ${s.branches ?? 0} branch(es): ${s.which || '-'}`)

// ── 4. Other General rows that look the same (reported, never touched) ─────
console.log('4. other one-branch rows still marked general (report only)')
const others = await q(`
  SELECT i.item_id, i.name, string_agg(DISTINCT b.code, ',') AS which
  FROM items i
  JOIN branch_item_prices bip ON bip.item_id = i.item_id
  JOIN branches b ON b.id = bip.branch_id
  WHERE COALESCE(i.source, 'general') = 'general'
    AND bip.cycle_id = (SELECT id FROM cycles WHERE is_active LIMIT 1)
  GROUP BY i.item_id, i.name
  HAVING COUNT(DISTINCT bip.branch_id) < 5
  ORDER BY i.item_id`)
for (const o of others) {
  console.log(`       ${o.item_id === ITEM ? '(this row) ' : 'NEEDS REVIEW '}${o.item_id} ${o.name} — ${o.which}`)
}

// ── 5. Apply ───────────────────────────────────────────────────────────────
if (!WRITE) {
  console.log(`\nDRY-RUN: would set items.source='outsourced' for item #${ITEM} (${item?.name}).`)
} else if (!item) {
  console.log('\nNothing to do: item #360 is missing.')
  failures++
} else if (!activeLink) {
  console.log('\nRefusing: no active (uncancelled) survey entry points at #360, so there is nothing to justify Outsourced.')
  failures++
} else if (item.source === 'outsourced') {
  console.log('\nAlready outsourced — nothing to change.')
} else {
  await client.query('BEGIN')
  try {
    const res = await client.query(`UPDATE items SET source = 'outsourced' WHERE item_id = $1 AND COALESCE(source,'general') <> 'outsourced'`, [ITEM])
    await client.query('COMMIT')
    console.log(`\nApplied: items.source -> 'outsourced' for item #${ITEM} (${res.rowCount} row(s)).`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('\nFAILED, rolled back:', e.message)
    failures++
  }
}

// ── 6. Verify ──────────────────────────────────────────────────────────────
console.log('6. verify')
const [after] = await q(`SELECT item_id, name, source FROM items WHERE item_id = $1`, [ITEM])
console.log(`       item #${after?.item_id} "${after?.name}" source = ${after?.source}`)
if (WRITE) check(after?.source === 'outsourced', 'source is now outsourced')

await client.end()
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
