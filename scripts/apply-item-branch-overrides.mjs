// scripts/apply-item-branch-overrides.mjs
// Applies migrations/add-item-branch-overrides.sql to the live database:
// creates public.item_branch_overrides (per-branch display fields for
// OUTSOURCED items) and prints the outsourced items priced by more than one
// branch so the admin can see exactly which products become branch-scoped.
//
// No data is written besides the DDL — an item displays the shared catalog
// copy wherever a branch has no override row, so existing branches continue
// to show what they show today. Per-branch copies are created by the admin's
// own saves (the Items Import editor freeze+write path in
// app/api/admin/items/route.js POST).
//
// Env: SUPABASE_DB_URL (loaded from .env.local / .env.local.remote / .env).
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
  await c.query(`CREATE TABLE IF NOT EXISTS public.item_branch_overrides (
    id         BIGSERIAL PRIMARY KEY,
    branch_id  BIGINT NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    item_id    BIGINT NOT NULL REFERENCES public.items(item_id) ON DELETE CASCADE,
    name       TEXT,
    category   TEXT,
    unit       TEXT,
    image_url  TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (branch_id, item_id)
  )`)
  await c.query(`CREATE INDEX IF NOT EXISTS idx_item_branch_overrides_item
    ON public.item_branch_overrides(item_id)`)
  await c.query(`COMMENT ON TABLE public.item_branch_overrides IS
    'Per-branch display fields (name/category/unit/image) for OUTSOURCED items; GENERAL items remain one shared catalog.'`)
  console.log('OK: public.item_branch_overrides ready.')

  const multi = await c.query(`
    SELECT i.item_id, i.name, i.category, i.unit, i.source,
           COUNT(*) FILTER (WHERE p.price > 0) AS priced_branches
      FROM public.items i
      JOIN public.branch_item_prices p ON p.item_id = i.item_id
     WHERE COALESCE(i.source, 'general') = 'outsourced'
       AND i.is_active IS NOT FALSE
     GROUP BY i.item_id
    HAVING COUNT(*) FILTER (WHERE p.price > 0) > 1
     ORDER BY priced_branches DESC, i.name`)
  console.log('─'.repeat(64))
  console.log(`OUTSOURCED items now priced by MORE THAN ONE branch: ${multi.rows.length}`)
  for (const r of multi.rows.slice(0, 40)) {
    console.log(`  #${r.item_id}  ${r.name}  [${r.category || '—'} / ${r.unit || '—'}]  → ${r.priced_branches} branches`)
  }
  const existing = await c.query('SELECT COUNT(*) n FROM public.item_branch_overrides')
  console.log(`Existing override rows: ${existing.rows[0].n}`)
  console.log('No branch data was copied — each branch shows the shared copy until its own card is edited.')
} finally {
  await c.end()
}
