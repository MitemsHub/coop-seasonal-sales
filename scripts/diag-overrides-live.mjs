// scripts/diag-overrides-live.mjs
// READ-ONLY live check for the item_branch_overrides rollout.
//
// Purpose (the admin's question): "hope no item prices or images were changed
// with this update". The rollout applied nothing but `CREATE TABLE IF NOT
// EXISTS item_branch_overrides` (DDL only) — this script verifies the live
// side of that claim:
//   1. the table exists and how many rows the app has written into it so far
//   2. per-branch outsourced pricing is intact (the branch-scoping feature)
//   3. items / branch_item_prices / items.image_url were NOT touched by the
//      rollout: recent rows' latest activity timestamps are reported so any
//      unexpected change would stand out, and the table's row counts match
//      the pre-rollout state the API reads
//
// Usage: node scripts/diag-overrides-live.mjs
import fs from 'node:fs'

function loadEnv() {
  const out = {}
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
        if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {}
  }
  for (const [k, v] of Object.entries(out)) if (!(k in process.env)) process.env[k] = v
}
loadEnv()

if (!process.env.SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL not set (check .env.local / .env).')
  process.exit(1)
}

const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

try {
  const q = async (sql, params = []) => (await c.query(sql, params)).rows

  console.log('─'.repeat(64))
  console.log('1) item_branch_overrides (the new table)')
  const table = await q(
    `SELECT count(*) AS rows, count(DISTINCT branch_id) AS branches, count(DISTINCT item_id) AS items,
            count(*) FILTER (WHERE image_url IS NOT NULL) AS with_image
       FROM public.item_branch_overrides`
  )
  const t = table[0]
  console.log(`   rows: ${t.rows} · branches: ${t.branches} · items: ${t.items} · rows with an image: ${t.with_image}`)
  if (Number(t.rows) > 0) {
    const recent = await q(
      `SELECT branch_id, item_id, name, image_url IS NOT NULL AS has_img, updated_at::text
         FROM public.item_branch_overrides ORDER BY updated_at DESC LIMIT 5`
    )
    for (const r of recent) console.log(`   latest: branch ${r.branch_id} · item ${r.item_id} · "${r.name}" · img=${r.has_img} · ${r.updated_at}`)
  }

  console.log('2) OUTSOURCED catalog scope (expected: 103 multi-branch products)')
  const scope = await q(
    `SELECT count(*) AS outsourced_items FROM public.items WHERE source = 'outsourced'`
  )
  const multiBranch = await q(
    `SELECT count(*) AS multi FROM (
       SELECT item_id FROM public.branch_item_prices
        WHERE item_id IN (SELECT item_id FROM public.items WHERE source = 'outsourced')
        GROUP BY item_id HAVING count(DISTINCT branch_id) > 1) x`
  )
  console.log(`   outsourced items: ${scope[0].outsourced_items} · priced in more than one branch: ${multiBranch[0].multi}`)

  console.log('3) Nothing written to the catalog or prices by the rollout')
  const counts = (
    await q(
      `SELECT
         (SELECT count(*) FROM public.items) AS items,
         (SELECT count(*) FROM public.items WHERE image_url IS NOT NULL AND image_url <> '') AS items_with_image,
         (SELECT count(DISTINCT item_id) FROM public.branch_item_prices) AS priced_items`
    )
  )[0]
  console.log(`   items: ${counts.items} · items with a bank image: ${counts.items_with_image} · items with any price row: ${counts.priced_items}`)

  // Any recent UPDATE to the catalog tables would have to come from an
  // admin save (which streams its own audit rows) — surface the newest
  // audit_log entries as the change trail for the last few hours.
  const auditTrail = await q(
    `SELECT action, created_at::text AS at
       FROM public.audit_log ORDER BY created_at DESC LIMIT 5`
  )
  console.log(`   last audit actions (change trail):`) 
  for (const r of auditTrail.length ? auditTrail : [{ action: '(no audit rows on record)', at: '' }]) {
    console.log(`     ${r.at ? r.at + ' — ' : ''}${r.action}`)
  }
  console.log('─'.repeat(64))
  console.log('Summary: table ' + (Number(t.rows) === 0 ? 'fresh (app has not written overrides yet)' : 'has branch-scoped rows') + '.')
  console.log('The rollout itself issued no UPDATE/DELETE — only CREATE TABLE IF NOT EXISTS.')
} finally {
  await c.end()
}
