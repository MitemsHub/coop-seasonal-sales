// scripts/audit-retired-twins.mjs
// READ-ONLY one-off audit (no writes anywhere — the user decides what to purge).
//
// Finds every items row with is_active = false that duplicates a STILL-ACTIVE
// row by:
//   1. normalized name  (lowercased, whitespace-collapsed)  — the "ghost twin"
//      shape that made e.g. "Gino Tomatoes Sachet" unsearchable in the
//      refined-image picker;
//   2. shared image URL (path without query suffix)        — since images are
//      linked once and re-linked, a shared URL means the two rows point at
//      the same bank photo.
// For every duplicate found it also counts priced branches
// (branch_item_prices) so the purge
// decision can weigh "safe to hard-delete" vs "must stay retired (priced there)".
//
// Run: node scripts/audit-retired-twins.mjs
import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: process.env.SUPABASE_DB_URL && !/(localhost|127\.0\.0\.1)/.test(process.env.SUPABASE_DB_URL)
    ? { rejectUnauthorized: false }
    : false,
  max: 2,
  connectionTimeoutMillis: 15000,
})

const q = async (sql) => (await pool.query(sql)).rows

const nameDupes = await q(`
  WITH retired AS (
    SELECT regexp_replace(lower(trim(name)), '\\s+', ' ', 'g') AS norm_name
    FROM public.items WHERE is_active = false
  )
  SELECT i.norm_name,
         jsonb_agg(jsonb_build_object(
           'id', i.item_id, 'active', i.is_active, 'name', i.name, 'sku', i.sku,
           'image', i.image_url
         ) ORDER BY i.is_active DESC, i.item_id)        AS members
  FROM (
    SELECT item_id, name, sku, image_url, is_active,
           regexp_replace(lower(trim(name)), '\\s+', ' ', 'g') AS norm_name
    FROM public.items
  ) i
  JOIN retired r ON r.norm_name = i.norm_name
  GROUP BY i.norm_name
  HAVING bool_or(i.is_active) AND bool_or(NOT i.is_active)
  ORDER BY i.norm_name
`)

const urlDupes = await q(`
  WITH retired AS (
    SELECT regexp_replace(split_part(image_url, '?', 1), '/+$', '') AS img_path
    FROM public.items
    WHERE is_active = false AND image_url IS NOT NULL AND image_url <> ''
  )
  SELECT i.img_path,
         jsonb_agg(jsonb_build_object(
           'id', i.item_id, 'active', i.is_active, 'name', i.name, 'sku', i.sku,
           'image', i.image_url
         ) ORDER BY i.is_active DESC, i.item_id)        AS members
  FROM (
    SELECT item_id, name, sku, image_url, is_active,
           regexp_replace(split_part(image_url, '?', 1), '/+$', '') AS img_path
    FROM public.items
    WHERE image_url IS NOT NULL AND image_url <> ''
  ) i
  JOIN retired r ON r.img_path = i.img_path
  GROUP BY i.img_path
  HAVING bool_or(i.is_active) AND bool_or(NOT i.is_active)
  ORDER BY i.img_path
`)

// History reach for every retired row that appears in either duplicate set.
const ids = [
  ...new Set([
    ...nameDupes.flatMap((g) => g.members.filter((m) => m.active === false).map((m) => m.id)),
    ...urlDupes.flatMap((g) => g.members.filter((m) => m.active === false).map((m) => m.id)),
  ]),
]
const reach = ids.length
  ? (
      await pool.query(
        `
    SELECT i.item_id,
           (SELECT count(*)::int FROM public.branch_item_prices p WHERE p.item_id = i.item_id) AS priced_branches
    FROM (SELECT unnest($1::bigint[]) AS item_id) x
    JOIN public.items i ON i.item_id = x.item_id
    ORDER BY i.item_id
  `,
        [ids]
      )
    ).rows
  : []
const reachById = Object.fromEntries(reach.map((r) => [Number(r.item_id), r]))

let n = 0
const fmt = (dupes, label) => {
  console.log(`\n=== ${label} (${dupes.length}) ===`)
  for (const g of dupes) {
    console.log(`\n#${++n} ${label === 'SAME NAME' ? `name="${g.norm_name}"` : `image=${g.img_path}`}`)
    for (const m of g.members) {
      const hist = m.active ? '' : ` | priced_branches=${reachById[m.id]?.priced_branches ?? '?'}`
      console.log(`   ${m.active ? 'ACTIVE ' : 'RETIRED'} #${m.id} "${m.name}" sku=${m.sku} img=${m.image || '-'}` + hist)
    }
  }
}

const retired = await q(`SELECT count(*)::int AS c FROM public.items WHERE is_active = false`)
const active = await q(`SELECT count(*)::int AS c FROM public.items WHERE is_active = true`)
console.log(`items: ${active[0].c} active, ${retired[0].c} retired`)
fmt(nameDupes, 'SAME NAME')
fmt(urlDupes, 'SAME IMAGE URL')
if (!nameDupes.length && !urlDupes.length) console.log('\nNo active-vs-retired duplicates by either key.')

// scripts/order-held-check.js
// Fragment appended to audit-retired-twins.mjs: flags every retired item
// still referenced by order_lines — those can never be hard-deleted (FK
// order_lines_item_id_fkey), so purge plans must remap history first.
const orderHeld = (await pool.query(`
  SELECT i.item_id, i.sku, i.name, count(*)::int AS n,
         min(o.created_at)::date AS first_order, max(o.created_at)::date AS last_order
  FROM public.items i
  JOIN public.order_lines ol ON ol.item_id = i.item_id
  LEFT JOIN public.orders o ON o.order_id = ol.order_id
  WHERE i.is_active = false
  GROUP BY i.item_id, i.sku, i.name
  ORDER BY n DESC`)).rows
console.log(`\n=== ORDER-HELD RETIRED ITEMS (${orderHeld.length}) — hard-delete blocked; remap history first ===`)
for (const r of orderHeld) {
  console.log(`   RETIRED #${r.item_id} "${r.name}" sku=${r.sku} | order_lines=${r.n} (${r.first_order} -> ${r.last_order})`)
}
if (!orderHeld.length) console.log('   none — every retired row is detached from order history.')

await pool.end()
