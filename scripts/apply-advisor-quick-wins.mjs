// Applies the advisor "quick wins" Step 1 for coop-seasonal-sales:
//   A) Pin SET search_path = public on every public function with a mutable
//      search_path (advisor security check) — behavior-preserving.
//   B) DROP INDEX CONCURRENTLY for the 13 redundant duplicate indexes —
//      keeps, per group, the most-used / constraint-backed index.
// Dry-run by default; pass --apply to execute. Writes an SQL restore backup
// for every dropped index before dropping anything.
import fs from 'node:fs'
import 'dotenv/config'
if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try { const m = fs.readFileSync(f, 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m); if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^[\"']|[\"']$/g, ''); break } } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL'); process.exit(1) }
const APPLY = process.argv.includes('--apply')

const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

// ── A) Functions ──────────────────────────────────────────────────────────
const fns = await c.query(`
  SELECT p.oid::regprocedure::text AS sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND (p.proconfig IS NULL OR NOT p.proconfig::text ILIKE '%search_path%')
  ORDER BY 1`)
console.log(`A) Functions to pin (search_path = public): ${fns.rows.length}`)

// ── B) Duplicate index groups ─────────────────────────────────────────────
const dups = await c.query(`
  SELECT tab.relname AS table_name,
         array_agg(idx.indexrelid::regclass::text ORDER BY idx.indexrelid::regclass::text) AS idx_names
  FROM pg_index idx
  JOIN pg_class tab ON tab.oid = idx.indrelid
  JOIN pg_namespace n ON n.oid = tab.relnamespace
  WHERE n.nspname = 'public'
  GROUP BY tab.relname, idx.indrelid, idx.indclass, idx.indkey::text, idx.indnatts,
           idx.indisunique, COALESCE(pg_get_expr(idx.indpred, idx.indrelid), 'NULL'), idx.indnkeyatts
  HAVING COUNT(*) > 1
  ORDER BY tab.relname`)

// For each group decide the keeper: highest usage stats, then
// constraint-backing, then prefer the plain (non-_performance) name.
const dropIdx = []
for (const g of dups.rows) {
  const dets = []
  for (const idxName of g.idx_names) {
    const dd = await c.query(`
      SELECT $1::regclass::text AS name,
             pg_size_pretty(pg_relation_size($1::regclass)) AS size,
             COALESCE((SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelid = $1::regclass), 0)::bigint AS scans,
             EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = $1::regclass) AS backs_constraint`,
      [idxName.replace(/^public\./, '') === idxName ? `public.${idxName}` : idxName])
    dets.push({ name: idxName.replace(/^public\./, ''), size: dd.rows[0].size, scans: dd.rows[0].scans, backs: dd.rows[0].backs_constraint })
  }
  // Constraint-backed indexes can never be dropped — always the keeper.
  dets.sort((a, b) => ((b.backs ? 1 : 0) - (a.backs ? 1 : 0)) ||
    (Number(b.scans) - Number(a.scans)) ||
    (a.name.includes('_performance') ? 1 : 0) - (b.name.includes('_performance') ? 1 : 0))
  const keeper = dets[0]
  for (const d of dets.slice(1)) dropIdx.push(d)
  console.log(` ${g.table_name}: keep ${keeper.name} (scans=${keeper.scans}${keeper.backs ? ', constraint-backed' : ''}); drop ${dets.slice(1).map(d => d.name).join(', ')}`)
}

if (!APPLY) {
  console.log(`\nDRY RUN — ${fns.rows.length} functions would be pinned, ${dropIdx.length} indexes would be dropped. Re-run with --apply.`)
  await c.end()
  process.exit(0)
}

console.log(`\nAPPLY — ${APPLY ? 'confirmed' : ''}`)

// Backup dropped indexes (definition + validity) before touching anything.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupSql = []
const backupJson = []
for (const d of dropIdx) {
  const def = await c.query(`
    SELECT pg_get_indexdef($1::regclass) AS def, idx.indisvalid AS valid
    FROM pg_index idx WHERE idx.indexrelid = $1::regclass`, [`public.${d.name}`])
  backupSql.push(`-- restore: ${d.name}\n${def.rows[0].def};`)
  backupJson.push({ name: d.name, size: d.size, scans: d.scans, definition: def.rows[0].def, valid: def.rows[0].valid })
}
fs.writeFileSync(`scripts/advisor-quick-wins-index-backup-${stamp}.json`, JSON.stringify(backupJson, null, 2))
fs.writeFileSync(`scripts/advisor-quick-wins-index-backup-${stamp}.sql`,
  `-- Restore script for indexes dropped by apply-advisor-quick-wins ${stamp}\n` +
  backupSql.join('\n\n') + '\n')
console.log(`Backed up ${dropIdx.length} index definitions to scripts/advisor-quick-wins-index-backup-${stamp}.{json,sql}`)

// A) ALTER FUNCTION ... SET search_path = public
let altered = 0
for (const r of fns.rows) {
  try {
    await c.query(`ALTER FUNCTION ${r.sig} SET search_path = public`)
    altered++
  } catch (e) {
    console.warn(`  WARN could not pin ${r.sig}: ${e.message.slice(0, 120)}`)
  }
}
console.log(`Pinned search_path on ${altered}/${fns.rows.length} functions.`)

// B) DROP INDEX CONCURRENTLY (outside transactions — do NOT open a tx)
let dropped = 0
for (const d of dropIdx) {
  try {
    await c.query(`DROP INDEX CONCURRENTLY IF EXISTS public."${d.name}"`)
    console.log(`  dropped ${d.name} (was ${d.size}, scans=${d.scans})`)
    dropped++
  } catch (e) {
    console.warn(`  WARN could not drop ${d.name}: ${e.message.slice(0, 160)}`)
  }
}
console.log(`Dropped ${dropped}/${dropIdx.length} duplicate indexes.`)

// Post-check
const pin = await c.query(`
  SELECT COUNT(*)::int n FROM pg_proc p
    JOIN pg_namespace n2 ON n2.oid = p.pronamespace
    WHERE n2.nspname='public' AND p.prokind='f'
    AND (p.proconfig IS NULL OR NOT p.proconfig::text ILIKE '%search_path%')`)
const dup2 = await c.query(`
  SELECT COUNT(*)::int n FROM (
    SELECT idx.indrelid
    FROM pg_index idx
    JOIN pg_class tab ON tab.oid = idx.indrelid
    JOIN pg_namespace n ON n.oid = tab.relnamespace
    WHERE n.nspname = 'public'
    GROUP BY idx.indrelid, idx.indclass, idx.indkey::text, idx.indnatts, idx.indisunique,
             COALESCE(pg_get_expr(idx.indpred, idx.indrelid), 'NULL'), idx.indnkeyatts
    HAVING COUNT(*) > 1) x`)
console.log(`POST-CHECK: functions still unpinned=${pin.rows[0].n}, duplicate index groups=${dup2.rows[0].n}`)
await c.end()
console.log('DONE')
