// ADMIN TOOL — replicate one branch's live survey + prices to other branches
// (the self-serve version of the Abuja/Head-Office replication done for you
// on 2026-10-21).
//
// What it copies FROM a source branch FOR THE ACTIVE CYCLE:
//   1. every non-cancelled survey entry (with rep photos, categories, prices),
//      written into a NEW submission tagged "replicated from <source>" per
//      target branch (created once, then reused — safe to re-run)
//   2. the saved product's cycle price row *for the source branch's price*
//      — existing target price rows always win (never overwritten)
//   3. the target branch's rep_phone is filled from the source branch if
//      the target has none (or --phone overrides)
//
// Use it any time one rep serves several branches selling the same items —
// then let the admin refine links per branch in Items Import as usual.
//
// Usage:
//   node scripts/replicate-branch.mjs [--dry]            # interactive list of branches
//   node scripts/replicate-branch.mjs --from 5 --to 37,42 [--dry] [--phone 080...]
//   node scripts/replicate-branch.mjs --list             # show branch ids
//
// Idempotent: re-running copies nothing twice; already-present entries and
// prices are skipped and reported as such.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const txt = fs.readFileSync(f, 'utf8')
      const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const DRY = process.argv.includes('--dry')
const arg = (name) => {
  const i = process.argv.indexOf('--' + name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null
}
const FROM = arg('from') && Number(arg('from'))
let TO = (arg('to') || '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
const PHONE = arg('phone')

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const run = async (label, sql, p = []) => {
  if (DRY) { console.log(`[dry] ${label}`); return null }
  const res = await c.query(sql, p)
  console.log(`[ok ] ${label} — ${res.rowCount} row(s)`)
  return res
}

// ── resolve the active cycle ─────────────────────────────────────────
const [cycle] = await q(`SELECT id, code FROM cycles WHERE is_active = TRUE ORDER BY id DESC LIMIT 1`)
const CYCLE = arg('cycle') && Number(arg('cycle')) || cycle?.id
if (!CYCLE) { console.error('No active cycle found'); process.exit(1) }
console.log(`cycle: #${CYCLE} (${cycle?.code || ''})${DRY ? '  [DRY-RUN: nothing will be written]' : ''}\n`)

// ── list branches ─────────────────────────────────────────────────────
const branches = await q(`SELECT id, code, name, rep_phone FROM branches ORDER BY name`)
if (process.argv.includes('--list') || !FROM || !TO.length) {
  console.table(branches)
  console.log('Usage: node scripts/replicate-branch.mjs --from <branch_id> --to <id1,id2,...> [--dry] [--cycle <id>] [--phone <number>]')
  await c.end()
  process.exit(FROM && TO.length ? 0 : 1)
}

// ── pick the source branch's latest live submission for this cycle ────
const [srcBranch] = await q(`SELECT id, name, rep_phone FROM branches WHERE id = $1`, [FROM])
if (!srcBranch) { console.error(`source branch ${FROM} not found`); process.exit(1) }
const [srcSub] = await q(`
  SELECT s.id FROM food_survey_submissions s
  WHERE s.branch_id = $1 AND (s.cycle_id = $2 OR s.cycle_id IS NULL)
  ORDER BY s.cycle_id IS NULL, s.cycle_id DESC, s.created_at DESC LIMIT 1`, [FROM, CYCLE])
if (!srcSub) { console.error(`no survey submission for ${srcBranch.name} in cycle ${CYCLE} (or undated)`); process.exit(1) }
const srcEntries = await q(`
  SELECT id, catalog_id, item_name, category, price, photo_url, saved_item_id, cancelled
  FROM food_survey_entries WHERE submission_id = $1 ORDER BY id`, [srcSub.id])
console.log(`source: ${srcBranch.name} (#${FROM}) — submission #${srcSub.id}, ${srcEntries.length} entries\n`)

// ── replicate per target branch ───────────────────────────────────────
for (const target of TO) {
  if (target === FROM) { console.log(`skip ${target} (source)`); continue }
  const [br] = await q(`SELECT id, name, rep_phone FROM branches WHERE id = $1`, [target])
  if (!br) { console.error(`target ${target} not found — skipping`); continue }
  console.log(`─── ${br.name} (#${br.id}) ───`)

  // rep_phone backfill / override
  const wantedPhone = PHONE || srcBranch.rep_phone
  if (wantedPhone && !br.rep_phone) {
    await run(`backfill rep_phone for ${br.name}`, `UPDATE branches SET rep_phone = $1 WHERE id = $2`, [wantedPhone, br.id])
  }

  // submission (create once; identify ours by the notes tag)
  const [existing] = await q(`
    SELECT id FROM food_survey_submissions
    WHERE branch_id = $1 AND cycle_id = $2 AND notes LIKE '%replicated-from-%' LIMIT 1`, [target, CYCLE])
  let subId
  if (existing) {
    subId = existing.id
    console.log(`submission exists → reuse #${subId}`)
  } else {
    if (DRY) { subId = '(new)'; console.log(`[dry] create submission + copy entries`) }
    else {
      const ins = await c.query(
        `INSERT INTO food_survey_submissions (rep_name, branch_id, cycle_id, source, notes, phone)
         SELECT rep_name, $2, cycle_id, 'rep', $3, phone FROM food_survey_submissions WHERE id = $1 RETURNING id`,
        [srcSub.id, target, `replicated from ${srcBranch.name} by replicate-branch.mjs`]
      )
      subId = ins.rows[0].id
      await c.query(
        `INSERT INTO audit_log (actor, action, module, detail) VALUES ($1, $2, $3, $4::jsonb)`,
        ['replicate-branch', 'new-submission', 'survey', JSON.stringify({ from: FROM, to: target, cycle: CYCLE, submission: Number(subId) })]
      )
      console.log(`[ok ] new submission #${subId}`)
      let copied = 0, skipped = 0
      for (const e of srcEntries) {
        const [dupe] = await q(`
          SELECT e.id FROM food_survey_entries e JOIN food_survey_submissions s ON s.id = e.submission_id
          WHERE s.branch_id = $1 AND s.cycle_id = $2 AND lower(trim(e.item_name)) = lower(trim($3)) LIMIT 1`,
          [target, CYCLE, e.item_name])
        if (dupe) { skipped++; continue }
        await c.query(
          `INSERT INTO food_survey_entries
             (submission_id, catalog_id, item_name, category, price, photo_url, saved_item_id, cancelled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [Number(subId), e.catalog_id, e.item_name, e.category, e.price, e.photo_url, e.saved_item_id, e.cancelled === true])
        copied++
      }
      console.log(`entries: ${copied} copied${skipped ? `, ${skipped} skipped (already present)` : ''}`)
    }
  }

  // prices — the source branch's own cycle price for each saved product
  if (!DRY) {
    let written = 0, kept = 0, noSrc = 0
    for (const e of srcEntries) {
      if (e.saved_item_id == null || e.cancelled === true) continue
      const itemId = Number(e.saved_item_id)
      const [srcPrice] = await q(
        `SELECT price FROM branch_item_prices WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1`,
        [FROM, itemId, CYCLE])
      if (!srcPrice) { noSrc++; continue }
      const [tgt] = await q(
        `SELECT price FROM branch_item_prices WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1`,
        [target, itemId, CYCLE])
      if (tgt) { kept++; continue }
      await c.query(`INSERT INTO branch_item_prices (branch_id, item_id, cycle_id, price) VALUES ($1, $2, $3, $4)`,
        [target, itemId, CYCLE, srcPrice.price])
      written++
    }
    console.log(`prices: ${written} written, ${kept} kept (already present), ${noSrc} unpriced at source`)
  }
}

console.log(`\nDone. Verify with: node scripts/audit-outsourced-price-spread.mjs`)
await c.end()
