// scripts/diag-disk-io.mjs
// Read-only diagnostics for Supabase "Disk IO Budget" warnings.
// Runs only SELECTs against the project DB (via SUPABASE_DB_URL).
// Usage: node scripts/diag-disk-io.mjs
import fs from 'node:fs'
import pg from 'pg'

function envFile(p) { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
let dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  for (const f of ['.env.local', '.env.local.remote', '.env', '.env.local.test']) {
    const m = envFile(f).match(/^SUPABASE_DB_URL=(.*)$/m)
    if (m) { dbUrl = m[1].replace(/^["']|["']$/g, '').trim(); break }
  }
}
if (!dbUrl) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await client.connect()

async function section(title, sql) {
  console.log(`\n=== ${title} ===`)
  try {
    const { rows } = await client.query(sql)
    if (!rows.length) { console.log('(no rows)'); return rows }
    const cols = Object.keys(rows[0])
    const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))
    console.log(cols.map((c, i) => c.padEnd(widths[i])).join('  '))
    console.log(cols.map((c, i) => '-'.repeat(widths[i])).join('  '))
    for (const r of rows) console.log(cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '))
    return rows
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    return []
  }
}

await section('DB size', `
  select pg_size_pretty(pg_database_size(current_database())) as database_size`)

await section('Buffer cache hit rate (target >= 0.99)', `
  select round(sum(blks_hit)::numeric / nullif(sum(blks_hit + blks_read), 0), 4) as buffer_cache_hit,
         sum(blks_read) as blks_read_total,
         sum(blks_hit) as blks_hit_total
  from pg_stat_database where datname = current_database()`)

await section('Table cache hit rate', `
  select round(sum(heap_blks_hit)::numeric / nullif(sum(heap_blks_hit + heap_blks_read), 0), 4) as table_cache_hit,
         sum(heap_blks_read) as heap_blks_read
  from pg_statio_user_tables where schemaname = 'public'`)

await section('Top tables by rows read via seq scan (cumulative)', `
  select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup, n_dead_tup
  from pg_stat_user_tables
  where schemaname = 'public' and seq_scan > 0
  order by seq_tup_read desc
  limit 15`)

await section('Largest tables + index overhead', `
  select c.relname,
         pg_size_pretty(pg_relation_size(c.oid)) as table_size,
         pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) as index_size,
         pg_size_pretty(pg_total_relation_size(c.oid)) as total
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by pg_total_relation_size(c.oid) desc
  limit 15`)

await section('Dead tuples / autovacuum backlog', `
  select relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
  from pg_stat_user_tables
  where schemaname = 'public' and n_dead_tup > 500
  order by n_dead_tup desc
  limit 10`)

const hasPss = await client.query(`select 1 as ok from pg_extension where extname = 'pg_stat_statements'`)
if (hasPss.rows.length) {
  await section('pg_stat_statements: top by block I/O (shared+temp+dirtied)', `
    select calls,
           round(total_exec_time::numeric, 0) as total_ms,
           round(mean_exec_time::numeric, 1) as mean_ms,
           shared_blks_read, shared_blks_dirtied,
           temp_blks_read, temp_blks_written,
           pg_size_pretty(wal_bytes::bigint) as wal,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 150) as query
    from pg_stat_statements
    where dbid = (select oid from pg_database where datname = current_database())
    order by (shared_blks_read + shared_blks_dirtied + temp_blks_read + temp_blks_written) desc
    limit 25`)

  await section('pg_stat_statements: top by call count', `
    select calls,
           round(mean_exec_time::numeric, 1) as mean_ms,
           round(total_exec_time::numeric, 0) as total_ms,
           shared_blks_read, temp_blks_written,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 150) as query
    from pg_stat_statements
    where dbid = (select oid from pg_database where datname = current_database())
    order by calls desc
    limit 25`)

  await section('pg_stat_statements: temp-file spills (sorts/hashes over work_mem)', `
    select calls, temp_blks_written,
           round(mean_exec_time::numeric, 1) as mean_ms,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 150) as query
    from pg_stat_statements
    where dbid = (select oid from pg_database where datname = current_database())
      and temp_blks_written > 0
    order by temp_blks_written desc
    limit 15`)
} else {
  console.log('\n=== pg_stat_statements: NOT ENABLED ===')
  console.log('Enable it in Supabase Dashboard → Database → Extensions, then re-run.')
}

await section('Memory / planner settings', `
  select name, setting, unit from pg_settings
  where name in ('shared_buffers','work_mem','effective_cache_size','max_parallel_workers_per_gather','default_statistics_target','random_page_cost')
  order by name`)

await section('RLS policy count per table (policies re-run per query/row)', `
  select tablename, count(*) as policies
  from pg_policies where schemaname = 'public'
  group by tablename order by policies desc limit 12`)

await section('Index usage (size vs scans — unused indexes still cost writes)', `
  select i.indexrelname as index,
         pg_size_pretty(pg_relation_size(i.indexrelid)) as size,
         i.idx_scan as scans,
         t.relname as table
  from pg_stat_user_indexes i
  join pg_stat_user_tables t on t.relid = i.relid
  where i.schemaname = 'public'
  order by pg_relation_size(i.indexrelid) desc
  limit 15`)

await client.end()
console.log('\nDone (all queries were read-only).')
