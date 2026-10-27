// scripts/diag-disk-io-3.mjs
// Read-only: pg_cron scheduled jobs (a possible hidden IO source),
// pg_stat_statements reset window, WAL ranking, pg_net activity.
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
    for (const r of rows) console.log(cols.map((c, i) => String(r[c] ?? '').slice(0, widths[i] + 40).padEnd(widths[i])).join('  '))
    return rows
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    return []
  }
}

await section('pg_stat_statements reset window (totals are since this)', `
  select stats_reset, now() - stats_reset as since_reset
  from pg_stat_statements_info`)

await section('pg_cron jobs (scheduled SQL = guaranteed IO)', `
  select jobid, schedule, active, username, database, left(command, 140) as command
  from cron.job order by jobid`)

await section('pg_cron recent runs', `
  select j.jobid, d.status, d.start_time, d.end_time,
         round(extract(epoch from (d.end_time - d.start_time))::numeric, 1) as secs,
         left(coalesce(d.return_message, ''), 120) as msg, left(j.command, 100) as cmd
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  order by d.start_time desc limit 20`)

await section('Top WAL generators since reset (writes = disk IO)', `
  select sum(calls)::bigint as calls,
         pg_size_pretty(sum(wal_bytes)::bigint) as wal_total,
         left(regexp_replace(min(query), '\\s+', ' ', 'g'), 110) as query
  from pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
  group by queryid
  order by sum(wal_bytes) desc
  limit 15`)

await section('pg_net HTTP activity (DB-originated requests)', `
  select count(*) as responses,
         min(created_at) as oldest,
         max(created_at) as newest
  from net._http_response`)

await section('Top queries by total CPU time', `
  select calls, round(total_exec_time::numeric/1000, 1) as total_sec,
         round(mean_exec_time::numeric, 1) as mean_ms,
         left(regexp_replace(query, '\\s+', ' ', 'g'), 120) as query
  from pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
  order by total_exec_time desc limit 15`)

await section('Function count (size of pg-meta introspection)', `
  select count(*) as functions_in_db from pg_proc`)

await client.end()
console.log('\nDone (read-only).')
