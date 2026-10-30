// REPAIR: "So Klin 22g" (item #463) belongs to the OUTSOURCED section, not
// General Items.
//
// How it got there (this is the "why do outsourced items leak into General"
// case, the same shape as Fresh Red Oil 5L / item #360):
//
//   * #463 SOKLIN22G was a plain Image-Bank catalog row: source = 'general'
//     (the column default), unpriced.
//   * scripts/fix-soklin22g-twin.mjs (2026-10-24, the "-2 twin" cleanup) then
//     moved TWO outsourced facts onto it: survey entry 440 "Klin 22g"
//     (Uyo, ₦9,300, still live) was re-pointed to saved_item_id = 463, and
//     Uyo's cycle-3 price row travelled from the deleted twin (#464) to #463.
//     The script's own plan said "item 463 stays as-is" — so nothing ever
//     flipped source, and a branch-scoped rep product ended up wearing the
//     General badge ("Added once — priced in every branch").
//
// Evidence it is Outsourced (both signals must hold):
//   1. a live (uncancelled) rep survey entry points at it — entry 440,
//      branch UYO, cycle 3;
//   2. it is priced in exactly ONE branch of the 39 in the active cycle.
// A genuine General item is priced in every branch; #463 has exactly one
// price row: UYO / cycle 3 / ₦9,300.
//
// The repair is a one-column flip (items.source). No identity, price,
// override or receipt changes, so the freeze trigger is uninvolved. The shop
// reads branch_item_prices, not source: members see the same Uyo product at
// the same price afterwards — it simply moves from the General list to the
// Outsourced list, where its linked survey card already says
// "✓ Worked on · in shop".
//
// Companion guard (applied with this fix): migrations/
// enforce-survey-linked-item-source.sql — a trigger that flips general →
// outsourced whenever a survey draft is linked to a general item that is not
// priced in every branch, so no future script or save can recreate this.
//
// APPLY: node scripts/repair-so-klin-source.mjs --write   (default is dry-run)
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

const WRITE = process.argv.includes('--write')
console.log(WRITE ? 'MODE: WRITE — the change IS applied.\n' : 'MODE: DRY-RUN — no writes. Re-run with --write to apply.\n')

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows

const ITEM = 463
let failures = 0
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ── 1. The item ────────────────────────────────────────────────────────────
console.log('1. item #463')
const [item] = await q(`SELECT item_id, name, sku, source, is_active FROM items WHERE item_id = $1`, [ITEM])
check(Boolean(item), 'row exists', item ? `${item.name} / ${item.sku}` : 'missing')

// ── 2. Rep survey evidence ─────────────────────────────────────────────────
console.log('2. rep survey evidence (this is what makes it Outsourced)')
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
check(Boolean(activeLink), 'at least one entry is still live')

// ── 3. Pricing scope: General = priced in EVERY branch of the cycle ───────
console.log('3. pricing scope')
const scope = await q(`
  SELECT (SELECT COUNT(*)::int FROM branches) AS total_branches,
         COUNT(DISTINCT bip.branch_id)::int AS priced_branches,
         string_agg(DISTINCT b.code, ',') AS which
  FROM branch_item_prices bip JOIN branches b ON b.id = bip.branch_id
  WHERE bip.item_id = $1 AND bip.cycle_id = (SELECT id FROM cycles WHERE is_active LIMIT 1)`, [ITEM])
const s = scope[0] || {}
console.log(`       priced in ${s.priced_branches ?? 0} of ${s.total_branches ?? '?'} branches: ${s.which || '-'}`)
const branchScoped = Number(s.priced_branches || 0) < Number(s.total_branches || 0)
check(branchScoped, 'not priced in every branch (branch-scoped = Outsourced)')

// ── 4. Other leaks (report only — the trigger now prevents new ones) ──────
console.log('4. other general items that are survey-linked AND branch-scoped (report only)')
const others = await q(`
  SELECT i.item_id, i.name, i.source,
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
for (const o of others) {
  console.log(`       ${o.item_id === ITEM ? '(this row) ' : 'NEEDS REVIEW '}${o.item_id} ${o.name} — ${o.priced}/${o.total} branches`)
}
check(others.length <= 1 || others.every((o) => o.item_id === ITEM), 'no unexpected rows share this signature')

// ── 5. Backup + apply ──────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = `scripts/so-klin-source-backup-${stamp}.json`
fs.writeFileSync(backupPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  purpose: 'items.source flip general -> outsourced for item 463 (So Klin 22g)',
  item, links, scope: s,
}, null, 2))
console.log(`\nBackup written to ${backupPath}`)

if (!WRITE) {
  console.log(`DRY-RUN: would set items.source='outsourced' for item #${ITEM} (${item?.name}).`)
} else if (!item) {
  console.log('Nothing to do: item #463 is missing.'); failures++
} else if (!activeLink || !branchScoped) {
  console.log('Refusing: the evidence (live survey link + branch-scoped pricing) is not both present.'); failures++
} else if (item.source === 'outsourced') {
  console.log('Already outsourced — nothing to change.')
} else {
  await client.query('BEGIN')
  try {
    const res = await client.query(
      `UPDATE items SET source = 'outsourced' WHERE item_id = $1 AND COALESCE(source,'general') <> 'outsourced'`,
      [ITEM]
    )
    await client.query('COMMIT')
    console.log(`Applied: items.source -> 'outsourced' for item #${ITEM} (${res.rowCount} row(s)).`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('FAILED, rolled back:', e.message)
    failures++
  }
}

// ── 6. Verify ──────────────────────────────────────────────────────────────
console.log('6. verify')
const [after] = await q(`SELECT item_id, name, source FROM items WHERE item_id = $1`, [ITEM])
console.log(`       item #${after?.item_id} "${after?.name}" source = ${after?.source}`)
check(after?.source === 'outsourced', 'now classified Outsourced')

const guard = await q(`
  SELECT i.item_id, i.name FROM items i
  WHERE COALESCE(i.source,'general') = 'general'
    AND EXISTS (SELECT 1 FROM food_survey_entries e WHERE e.saved_item_id = i.item_id AND NOT e.cancelled)
    AND (SELECT COUNT(DISTINCT p.branch_id)::int FROM branch_item_prices p
           WHERE p.item_id = i.item_id
             AND p.cycle_id = (SELECT id FROM cycles WHERE is_active LIMIT 1))
        < (SELECT COUNT(*)::int FROM branches)`)
console.log(`       remaining leaks (should be 0): ${guard.length}`)

await client.end()
console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
