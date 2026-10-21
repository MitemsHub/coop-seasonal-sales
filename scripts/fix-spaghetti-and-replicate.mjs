// REPAIR: two DB changes requested by the admin on 2026-10-21.
//
//  A. Golden Penny Spaghetti (item #5, SPAGHETTIGP) currently ends up styled
//     as OUTSOURCED — with no image — on the branch cards, though the admin
//     says it is a general item. Flip its source to "general" (its price
//     rows stay at every branch, which a General item supports natively),
//     and give it the same item-images bucket path its siblings use
//     (SPAGHETTIMK/SPAGHETTIOBA/SPAGHETTIIRS all have bucket images; #5
//     was the only one left empty). No shop-preview Surviving survey drafts
//     are touched: the drafts that name-matched SPAGHETTIGP (Enugu, PH)
//     are just drafts — still there, still fine.
//  B. Abuja Branch (#37) and Head Office (#39) are served by the SAME rep
//     as Coop Secretariat (#5) — Ngozi Anthonia — selling the SAME items.
//     Replicate: (1) the Coop Secretariat replication-source submission
//     rows, (2) each linked product's price row for cycle 3, so items that
//     were only in the Secretariat's shop land in Abuja's and Head Office's
//     shop too. Existing rows win (idempotent). A new submission is written
//     per branch with entries copied over (including their rep photo URLs).
//
// DRY-RUN first is the norm: `node scripts/fix-spaghetti-and-replicate.mjs --dry`.
// Use --dry to inspect, then run without --dry to apply.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const txt = fs.readFileSync(f, 'utf8')
      const m = txt.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run')
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }
console.log(DRY ? 'MODE: DRY-RUN — no writes.\n' : 'MODE: WRITE — changes ARE applied.\n')

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows
const run = async (label, sql, p = []) => {
  if (DRY) { console.log(`[dry] ${label}`); return null }
  const before = (await q('SELECT COUNT(*)::int AS c FROM audit_log'))[0].c
  const res = await client.query(sql, p)
  await client.query(
    `INSERT INTO audit_log (actor, action, module, detail) VALUES ($1, $2, $3, $4::jsonb)`,
    ['repair-script', 'fix-spaghetti-and-replicate', 'items', JSON.stringify({ label, rows: res.rowCount })]
  )
  console.log(`[ok ] ${label} — ${res.rowCount} row(s)`)
  return res
}

// ══════════════════════════════════════════════════════════════════════
// A. Golden Penny Spaghetti (item #5) — outsourced → general + image
// ══════════════════════════════════════════════════════════════════════
{
  const [item] = await q(`SELECT item_id, sku, name, source, image_url FROM items WHERE item_id = 5`)
  console.log('item #5 before:', JSON.stringify(item))
  if (!item) { console.error('item #5 not found'); process.exit(1) }

  // Current repo state: only 3 items in public/images/items have files — but
  // this project's image bank lives in the Supabase "item-images" bucket
  // (public). Every other spaghetti product uses
  // https://lpzyvvsuksafnpchfdqw.supabase.co/storage/v1/object/public/item-images/items/<SKU>.png
  // — follow the same convention so the shop falls back to it.
  const base = 'https://lpzyvvsuksafnpchfdqw.supabase.co/storage/v1/object/public/item-images/items'
  const newUrl = item.sku ? `${base}/${item.sku}.png` : null
  const validUrl = newUrl ? await (async () => {
    try { const res = await fetch(newUrl, { method: 'HEAD' }); return res.ok } catch { return false }
  })() : false

  console.log(`bucket image ${newUrl}: ${validUrl ? 'EXISTS (HEAD 200)' : 'NOT FOUND — will skip setting image_url'}`)

  if (!DRY) {
    if (item.source !== 'general') {
      await run(
        `item #5 source outsourced → general`,
        `UPDATE items SET source = 'general' WHERE item_id = 5`
      )
    } else console.log('[ok ] item #5 already source=general — nothing to do')
    if (validUrl && (item.image_url || '') !== newUrl) {
      await run(`item #5 image_url → bucket/${item.sku}.png`, `UPDATE items SET image_url = $1 WHERE item_id = 5`, [newUrl])
    } else console.log(validUrl ? '[ok ] item #5 image already set' : '[skip] bucket image absent — image_url left as-is')
  }
}

// ═════════════════════════════════════════ STICKY NOTE (change me if needed)
// B. Replicate Coop Secretariat (branch 5, submission #34) → 37 Abuja + 39 HO
// ═══════════════════════════════════════════════════════════════════════════
const SRC_BRANCH = 5
const SRC_SUBMISSION = 34
const TARGETS = [37, 39]
const CYCLE = 3

const srcSub = (await q(`SELECT id, rep_name, branch_id, cycle_id, source, notes, phone FROM food_survey_submissions WHERE id = $1`, [SRC_SUBMISSION]))[0]
if (!srcSub) { console.error('Source submission #34 not found'); process.exit(1) }
console.log(`\nsource submission #34: rep=${srcSub.rep_name} branch=${srcSub.branch_id} cycle=${srcSub.cycle_id} entries source=`)

const srcEntries = await q(`
  SELECT id, catalog_id, item_name, category, price, photo_url, saved_item_id, cancelled
  FROM food_survey_entries WHERE submission_id = $1 ORDER BY id`, [SRC_SUBMISSION])
console.log(`source entries: ${srcEntries.length}`)

for (const target of TARGETS) {
  const [br] = await q(`SELECT id, name FROM branches WHERE id = $1`, [target])
  if (!br) { console.error(`target branch ${target} not found — skipping`); continue }
  console.log(`\n─── target: ${br.name} (#${br.id}) ───`)

  // 1. Does a replication submission for this branch already exist? Look for
  //    a submission created by this same repair source= before (idempotence).
  const existing = await q(`
    SELECT s.id FROM food_survey_submissions s
    WHERE s.branch_id = $1 AND s.cycle_id = $2 AND s.source = 'rep' AND s.notes LIKE '%replicated-from-secretariat%'`,
    [target, CYCLE])
  let subId
  if (existing.length) {
    subId = existing[0].id
    console.log(`   submission already exists → reuse id ${subId}`)
  } else if (DRY) {
    subId = '(new — DRY)'
    console.log(`   [dry] would CREATE submission for ${br.name} (notes "replicated from secretariat")`)
  } else {
    const ins = await client.query(
      `INSERT INTO food_survey_submissions (rep_name, branch_id, cycle_id, source, notes, phone)
       VALUES ($1, $2, $3, 'rep', $4, $5) RETURNING id, created_at`,
      [srcSub.rep_name, target, CYCLE, 'replicated from Coop Secretariat survey by repair script', srcSub.phone]
    )
    subId = ins.rows[0].id
    await client.query(
      `INSERT INTO audit_log (actor, action, module, detail) VALUES ($1, $2, $3, $4::jsonb)`,
      ['repair-script', 'fix-spaghetti-and-replicate', 'survey', JSON.stringify({ new_submission: Number(subId), branch: br.name })]
    )
    console.log(`   [ok ] created submission id ${subId}`)
  }

  // 2. Copy entries. Skip a source row when this branch already has an
  //    entry with the same name in this cycle (idempotence).
  let copied = 0, skipped = 0
  for (const e of srcEntries) {
    const dupe = await q(`
      SELECT e.id FROM food_survey_entries e
      JOIN food_survey_submissions s ON s.id = e.submission_id
      WHERE s.branch_id = $1 AND s.cycle_id = $2 AND lower(trim(e.item_name)) = lower(trim($3)) LIMIT 1`,
      [target, CYCLE, e.item_name])
    if (dupe.length) { skipped++; continue }
    if (!DRY) {
      await client.query(
        `INSERT INTO food_survey_entries
           (submission_id, catalog_id, item_name, category, price, photo_url, saved_item_id, cancelled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [Number(subId), e.catalog_id, e.item_name, e.category, e.price, e.photo_url, e.saved_item_id, e.cancelled === true]
      )
    }
    copied++
  }
  console.log(`   entries: ${copied} would-copied (DRY) / ${copied} copied${skipped ? `, ${skipped} skipped (already present)` : ''}`)

  // 3. Copy prices: for every saved product of the source branch's LIVE
  //    entries, put that product's price row into this branch (with the
  //    Coop Secretariat price). Existing price rows win (no overwrite).
  if (!DRY) {
    let pricesWritten = 0
    for (const e of srcEntries) {
      if (e.saved_item_id == null || e.cancelled === true) continue
      const itemId = Number(e.saved_item_id)
      const [srcPrice] = await q(`
        SELECT price FROM branch_item_prices
        WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1`, [SRC_BRANCH, itemId, CYCLE])
      if (!srcPrice) { console.log(`   – item ${itemId}: no cycle-3 price at source branch — skip`); continue }
      const [tgt] = await q(`
        SELECT price FROM branch_item_prices
        WHERE branch_id = $1 AND item_id = $2 AND cycle_id = $3 LIMIT 1`, [target, itemId, CYCLE])
      if (tgt) { console.log(`   – item ${itemId}: price already present for this branch (${tgt.price}) — keep`); continue }
      await client.query(
        `INSERT INTO branch_item_prices (branch_id, item_id, cycle_id, price) VALUES ($1, $2, $3, $4)`,
        [target, itemId, CYCLE, srcPrice.price]
      )
      pricesWritten++
    }
    console.log(`   prices written: ${pricesWritten}`)
  } else {
    console.log(`   [dry] would copy source prices for the ${srcEntries.filter(e=>e.saved_item_id!=null&&!e.cancelled).length} saved products`)
  }
}

console.log('\nRemaining manual step: none — verify with:')
console.log('  node scripts/diag-gh-items.mjs   (read-only)')
console.log('  node scripts/audit-outsourced-price-spread.mjs')
await client.end()
