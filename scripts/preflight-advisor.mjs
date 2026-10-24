// READ-ONLY preflight for the advisor quick-wins migration.
// Lists: (A) functions needing SET search_path, (B) duplicate index groups
// with size / usage / constraint-backing so we choose keepers safely.
import fs from 'node:fs'
import 'dotenv/config'
if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try { const m = fs.readFileSync(f, 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m); if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^[\"']|[\"']$/g, ''); break } } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL'); process.exit(1) }
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

console.log('══ A ═ Functions needing search_path pin —')
const fns = await c.query(`
  SELECT p.oid::regprocedure::text AS sig, p.proconfig, p.prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND (p.proconfig IS NULL OR NOT p.proconfig::text ILIKE '%search_path%')
  ORDER BY 1`)
for (const r of fns.rows) {
  console.log(`  ${r.sig}`)
  console.log(`      config=${JSON.stringify(r.proconfig)} securityDefiner=${r.prosecdef}`)
}

console.log('')
console.log('══ B ═ Duplicate index groups, with keep/drop evidence —')
const dups = await c.query(`
  SELECT tab.relname AS table_name,
         array_agg(idx.indexrelid::regclass::text ORDER BY idx.indexrelid::regclass::text) AS idxs_text,
         array_agg(DISTINCT idx.indisunique::text) AS uniques,
         array_agg(DISTINCT COALESCE(pg_get_expr(idx.indpred, idx.indrelid), 'NULL')) AS preds,
         array_agg(DISTINCT idx.indnatts) AS natts
  FROM pg_index idx
  JOIN pg_class tab ON tab.oid = idx.indrelid
  JOIN pg_namespace n ON n.oid = tab.relnamespace
  WHERE n.nspname = 'public'
  GROUP BY tab.relname, idx.indrelid, idx.indclass, idx.indkey::text, idx.indnatts, idx.indisunique, COALESCE(pg_get_expr(idx.indpred, idx.indrelid), 'NULL'), idx.indnkeyatts
  HAVING COUNT(*) > 1`)
for (const g of dups.rows) {
  console.log(` group on ${g.table_name} (unique=${g.uniques.join('+')}, predicate=${g.preds.join('|')}, natts=${g.natts.join('|')}):`)
  for (const full of g.idxs_text) {
    const name = full.replace(/^public\./, '')
    const d = await c.query(`
      SELECT pg_size_pretty(pg_relation_size($1::regclass)) AS size,
             COALESCE((SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelid = $1::regclass), 0)::bigint AS scans,
             EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = $1::regclass) AS backs_constraint
             FROM (SELECT 1) x`, [full])
    console.log(`      ${name}  size=${d.rows[0].size}  scans=${d.rows[0].scans}  constraintBacked=${d.rows[0].backs_constraint}`)
  }
}

await c.end()
console.log('DONE — read only')
