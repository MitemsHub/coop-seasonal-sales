// scripts/diag-disk-io-2.mjs
// Follow-up read-only diagnostics: full query text of the temp-spilling
// statement, stats-reset window, WAL ranking, and plans (EXPLAIN only —
// never ANALYZE, so nothing executes).
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

async function section(title, sql, opts = {}) {
  console.log(`\n=== ${title} ===`)
  try {
    const { rows } = await client.query(sql)
    if (!rows.length) { console.log('(no rows)'); return rows }
    for (const r of rows) {
      if (opts.raw) { console.log(JSON.stringify(r, null, 2)); continue }
      const cols = Object.keys(r)
      for (const c of cols) {
        const v = String(r[c] ?? '')
        console.log(`${c}: ${v.length > 400 ? v.slice(0, 400) + ' …[truncated]' : v}`)
      }
      console.log('---')
    }
    return rows
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    return []
  }
}

await section('Stats window (pg_stat_database reset)', `
  select stats_reset, now() - stats_reset as elapsed
  from pg_stat_database where datname = current_database()`)

await section('FULL TEXT: temp-spilling query', `
  select queryid, calls, round(mean_exec_time::numeric,1) as mean_ms,
         temp_blks_written, temp_blks_read, rows as total_rows, query
  from pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
    and temp_blks_written > 10000
  order by temp_blks_written desc limit 3`)

await section('FULL TEXT: count_estimate caller', `
  select queryid, calls, round(mean_exec_time::numeric,1) as mean_ms, query
  from pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
    and query ilike '%count_estimate%'
  limit 3`)

await section('FULL TEXT: the p_member_name RPC (confirm identity)', `
  select queryid, calls, round(mean_exec_time::numeric,1) as mean_ms, left(query, 600) as query
  from pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
    and query ilike '%p_member_name%' and query ilike '%pgrst%'
  limit 2`)

await section('Top WAL generators (writes = disk IO)', `
  select calls, pg_size_pretty(sum(wal_bytes)::bigint) as wal_total,
         round(sum(wal_bytes)::numeric / nullif(extract(epoch from (now() - (select stats_reset from pg_stat_database where datname = current_database()))),0) / 1024 / 1024, 4) as avg_mb_per_sec,
         left(regexp_replace(query, '\\s+', ' ', 'g'), 130) as query
  from pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
  group by query
  order by sum(wal_bytes) desc
  limit 15`)

await section('Connections by application/state', `
  select application_name, state, count(*)
  from pg_stat_activity where datname = current_database()
  group by 1, 2 order by 3 desc`)

await section('EXPLAIN: v_inventory_status full scan (plan only, no execution)', `
  explain (costs on) select * from public.v_inventory_status limit 5`)

await section('EXPLAIN: shop-style filtered query (plan only)', `
  explain (costs on)
  select * from public.v_inventory_status
  where branch_id = 1 and price is not null limit 20`)

await section('EXPLAIN: eligibility orders sum (plan only)', `
  explain (costs on)
  select total_amount from public.orders
  where member_id = 'A24460' and payment_option = 'Loan'
    and cycle_id = 1 and status in ('Pending','Posted','Delivered')`)

await client.end()
console.log('\nDone (EXPLAIN only — no query was executed).')
