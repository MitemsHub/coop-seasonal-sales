// READ-ONLY diagnostic — mirrors the four checks the Supabase advisor runs in
// its Security and Performance tabs so we can walk through the dashboard
// numbers without screenshots:
//   Security tab:       RLS disabled on tables, function search_path mutable
//   Performance tab:    unindexed foreign keys, duplicate indexes
// Prints counts and names only. Makes no changes.
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

console.log('══ 1 ═ Tables in the public schema (with RLS on/off) —')
const tables = await c.query(`
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_on,
         COALESCE(s.n_live_tup, 0)::bigint AS approx_rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relrowsecurity, c.relname`)
const withRls = [], withoutRls = []
for (const r of tables.rows) (r.rls_on ? withRls : withoutRls).push(r)
console.log(`   Total tables: ${tables.rows.length}`)
console.log(`   RLS ENABLED  (${withRls.length}): ${withRls.map(r => r.table_name).join(', ') || 'none'}`)
console.log(`   RLS DISABLED (${withoutRls.length}):`)
for (const r of withoutRls) console.log(`     ${r.table_name}  (~${r.approx_rows} rows)`)

console.log('')
console.log('══ 2 ═ Functions with a mutable search_path (advisor security check) —')
const fns = await c.query(`
  SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND (p.proconfig IS NULL OR NOT p.proconfig::text ILIKE '%search_path%')`)
console.log(`   Functions flagged: ${fns.rows.length}`)
const _proconfig = null

console.log('')
console.log('══ 3 ═ Duplicate indexes (advisor performance check) —')
const dups = await c.query(`
  SELECT tab.relname AS table_name,
         array_agg(idx.indexrelid::regclass::text ORDER BY idx.indexrelid::regclass::text) AS idxs_text
  FROM pg_index idx
  JOIN pg_class tab ON tab.oid = idx.indrelid
  JOIN pg_namespace n ON n.oid = tab.relnamespace
  WHERE n.nspname = 'public'
  GROUP BY tab.relname, idx.indrelid, idx.indclass, idx.indkey::text, idx.indnatts, idx.indisunique,
           COALESCE(pg_get_expr(idx.indpred, idx.indrelid), 'NULL'), idx.indnkeyatts
  HAVING COUNT(*) > 1`)
console.log(`   Index groups that duplicate each other: ${dups.rows.length}`)
for (const r of dups.rows) console.log(`   ${r.table_name}: ${r.idxs_text.join('  AND  ')}`)

console.log('')
console.log('══ 4 ═ Foreign keys without a covering index (advisor performance check) —')
const fk = await c.query(`
  SELECT con.conname AS constraint_name, con.conkey AS fk_attnums,
         con.conrelid::regclass::text AS from_table
  FROM pg_constraint con
  WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
  ORDER BY con.conrelid::regclass::text`)
const noIndex = []
for (const r of fk.rows) {
  const k = r.fk_attnums.length
  const keyLiteral = '{' + r.fk_attnums.join(',') + '}'
  const ixx = await c.query(
    `SELECT COUNT(*)::int AS n FROM pg_index idx
     WHERE idx.indrelid = $1::regclass
       AND (idx.indkey::smallint[])[1:${k}] = $2::smallint[]`,
    [r.from_table, keyLiteral])
  if (ixx.rows[0].n === 0) noIndex.push(r)
}

console.log('')
console.log('══ 5 ═ Approx counts of RLS policies present —')
const pol = await c.query(`SELECT schemaname, tablename, COUNT(*)::int AS n FROM pg_policies WHERE schemaname='public' GROUP BY 1,2 ORDER BY 2`)
console.log(`   Tables with at least one policy: ${pol.rows.length}`)
for (const r of pol.rows.slice(0, 30)) console.log(`   ${r.tablename}: ${r.n} policy/policies`)

await c.end()
console.log('\nDONE — read only')
