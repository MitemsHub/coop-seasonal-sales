// REPAIR: Golden Morn 45G (item 16, SKU GOLDENMORN45G) is flagged
// items.source = 'outsourced', so every admin shop preview badges it
// OUTSOURCED — but the admin says it is a General product (uniformly
// priced across all 39 branches at ₦23,214 like its sibling Golden Morn
// 900G, item 15, while Ibadan keeps the rep's ₦23,000 draft price).
// Same repair fix-spaghetti-and-replicate.mjs performed for Golden Penny
// Spaghetti (item 5): flip source outsourced → general. Prices, image,
// SKU and the Ibadan survey link (entry 1413 → item 16) are untouched —
// only the origin flag changes, which is what the preview badge reads.
//
// Also removes item_branch_overrides rows for this item that merely
// mirror the shared catalog copy: GENERAL items are one shared catalog
// (migrations/add-item-branch-overrides.sql), and a leftover per-branch
// override would silently pin that branch to stale values after a future
// General edit. Rows whose values DIFFER from the shared copy are kept
// and reported (never silently destroyed).
//
// DRY-RUN first is the norm: `node scripts/fix-golden-morn-45g-source.mjs --dry`
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
  const res = await client.query(sql, p)
  await client.query(
    `INSERT INTO audit_log (actor, action, module, detail) VALUES ($1, $2, $3, $4::jsonb)`,
    ['repair-script', 'fix-golden-morn-45g-source', 'items', JSON.stringify({ label, rows: res.rowCount })]
  )
  console.log(`[ok ] ${label} — ${res.rowCount} row(s)`)
  return res
}

const TARGET_SKU = 'GOLDENMORN45G'
const [item] = await q(
  `SELECT item_id, sku, name, category, unit, image_url, source FROM items WHERE sku = $1`,
  [TARGET_SKU]
)
if (!item) { console.error(`item ${TARGET_SKU} not found`); await client.end(); process.exit(1) }
console.log('item before:', JSON.stringify(item, null, 2))

// ── 1. source outsourced → general ─────────────────────────────────────
if (item.source === 'general') {
  console.log('[ok ] source already general — nothing to flip')
} else {
  await run(
    `${TARGET_SKU} source ${item.source} → general`,
    `UPDATE items SET source = 'general' WHERE sku = $1 AND COALESCE(source, 'general') = $2`,
    [TARGET_SKU, item.source]
  )
}

// ── 2. drop override rows that only mirror the shared copy ─────────────
const overrides = await q(
  `SELECT o.id, o.branch_id, b.name AS branch, o.name, o.category, o.unit, o.image_url
     FROM item_branch_overrides o JOIN branches b ON b.id = o.branch_id
    WHERE o.item_id = $1`,
  [item.item_id]
)
if (!overrides.length) console.log('[ok ] no branch overrides for this item')
for (const o of overrides) {
  const mirrors =
    (o.name == null || o.name === item.name) &&
    (o.category == null || o.category === item.category) &&
    (o.unit == null || o.unit === item.unit) &&
    (o.image_url == null || o.image_url === item.image_url)
  if (mirrors) {
    await run(
      `drop mirrored override for ${o.branch} (#${o.branch_id})`,
      `DELETE FROM item_branch_overrides WHERE id = $1`,
      [o.id]
    )
  } else {
    console.log(`[keep] override for ${o.branch} DIFFERS from shared copy — left in place:`, {
      name: o.name, category: o.category, unit: o.unit, image_url: o.image_url,
    })
  }
}

// ── verify ─────────────────────────────────────────────────────────────
const after = await q(`SELECT item_id, sku, name, source FROM items WHERE sku = $1`, [TARGET_SKU])
console.log('\nafter:', JSON.stringify(after[0]))
const links = await q(
  `SELECT e.id, e.item_name, e.cancelled, s.rep_name, b.name AS branch
     FROM food_survey_entries e
     JOIN food_survey_submissions s ON s.id = e.submission_id
     JOIN branches b ON b.id = s.branch_id
    WHERE e.saved_item_id = $1`,
  [item.item_id]
)
console.log('survey links left untouched:', JSON.stringify(links))

await client.end()
console.log(DRY ? '\nDONE (dry — nothing written)' : '\nDONE')
