// READ-ONLY administrative checks — no writes, no deletes.
//  1) Every item row named "Gino Tomatoes Sachet" (+ which branch prices and
//     survey entries reference it) so we can confirm each branch's shop card
//     resolves to ONE shared item row wearing ONE image.
//  2) Distinct categories across items/food_survey_catalog — surfaces typos
//     like "RlCE" and near-duplicates like "Oils" vs "Vegetable Oil".
//  3) ACTIVE outsourced items whose name matches an ACTIVE general item
//     (duplicates the admin may want to cancel from the outsourced list),
//     with the outsourced item's branch price rows so cancelling is informed.
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
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (sql, params = []) => (await c.query(sql, params)).rows
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

console.log('══ 1 ═ Gino Tomatoes Sachet — every item row by that name')
const ginItems = await q(
  `SELECT item_id, sku, name, is_active, source, image_url FROM items
   WHERE name ILIKE '%gino%' AND name ILIKE '%tomato%'
   ORDER BY is_active DESC, item_id`
)
for (const it of ginItems) {
  const survey = String(it.image_url || '').includes('/food-survey/')
  console.log(`item #${it.item_id} [${it.name}] sku=${it.sku} active=${it.is_active} source=${it.source}`)
  console.log(`   image: ${it.image_url || '(none)'}${survey ? '  ← SURVEY PHOTO' : ''}`)

  const prices = await q(
    `SELECT b.name AS branch, b.code, p.price, p.cycle_id FROM branch_item_prices p
     JOIN branches b ON b.id = p.branch_id WHERE p.item_id = $1 ORDER BY cycle_id, b.name`,
    [it.item_id]
  )
  for (const p of prices) console.log(`   price: ${p.branch} (${p.code}) cycle=${p.cycle_id} ₦${p.price}`)

  const entries = await q(
    `SELECT e.id, e.item_name, e.cancelled, b.name AS branch, s.cycle_id
     FROM food_survey_entries e
     JOIN food_survey_submissions s ON s.id = e.submission_id
     JOIN branches b ON b.id = s.branch_id
     WHERE e.saved_item_id = $1 ORDER BY s.cycle_id, b.name`,
    [it.item_id]
  )
  for (const e of entries) console.log(`   entry #${e.id} [${e.item_name}] ${e.branch} cycle=${e.cycle_id} cancelled=${e.cancelled}`)
}

console.log('')
console.log('══ 2 ═ Categories in the items table (count > 0), plus the survey catalog')
const cats = await q(`SELECT category, COUNT(*)::int AS n FROM items WHERE COALESCE(category,'') <> '' GROUP BY category ORDER BY n DESC, category`)
for (const r of cats) console.log(`   ${r.category}  (${r.n})`)
try {
  const sc = await q(`SELECT DISTINCT category FROM food_survey_catalog WHERE COALESCE(category,'') <> '' ORDER BY category`)
  console.log('   --- food_survey_catalog categories:')
  for (const r of sc) console.log(`   ${r.category}`)
} catch {}
// Near-duplicate categories after stripping spaces/punct — catches RlCE-style typos only
// when two distinct spellings collide on the same normalized key
const allCats = cats.map((r) => r.category)
const byKey = new Map()
for (const cat of allCats) {
  const key = norm(cat)
  if (!byKey.has(key)) byKey.set(key, [])
  byKey.get(key).push(cat)
}
console.log('   --- normalized collisions / 1-char-off pairs worth eyeballing:')
for (const [key, group] of byKey) {
  if (group.length > 1) console.log(`   ${key}: ${group.join(' | ')}`)
}
// Levenshtein-1 pairs across different normalized keys (RlCE vs RICE)
function dist1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, diff = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++diff > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else { i++; j++ }
  }
  return diff + (a.length - i) + (b.length - j) <= 1
}
for (let i = 0; i < allCats.length; i++) {
  for (let j = i + 1; j < allCats.length; j++) {
    const a = norm(allCats[i]), b = norm(allCats[j])
    if (a !== b && dist1(a, b)) console.log(`   near-duplicate: "${allCats[i]}" vs "${allCats[j]}"`)
  }
}

console.log('')
console.log('══ 3 ═ ACTIVE outsourced items that duplicate an ACTIVE general item')
const rows = await q(`
  SELECT o.item_id, o.sku, o.name, o.image_url, o.is_active,
         g.item_id AS general_id, g.sku AS general_sku, g.name AS general_name, g.is_active AS general_active,
         (SELECT COUNT(*)::int FROM branch_item_prices p WHERE p.item_id = o.item_id) AS priced_branches,
         (SELECT COUNT(*)::int FROM branch_item_prices p WHERE p.item_id = g.item_id) AS general_priced_branches
  FROM items o
  JOIN items g ON lower(regexp_replace(o.name, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(g.name, '[^a-zA-Z0-9]', '', 'g'))
  WHERE (COALESCE(o.source,'general') = 'outsourced')
    AND (COALESCE(g.source,'general') = 'general')
    AND o.is_active <> false
    AND g.is_active <> false
  ORDER BY o.name
`)
if (!rows.length) console.log('   (none — every active outsourced item is unique against general items)')
for (const r of rows) {
  console.log(`   outsourced #${r.item_id} [${r.name}] sku=${r.sku} · priced in ${r.priced_branches} branch(es)`)
  console.log(`     vs general  #${r.general_id} [${r.general_name}] sku=${r.general_sku} · priced in ${r.general_priced_branches} branch(es)`)
}

await c.end()
console.log('DONE')
