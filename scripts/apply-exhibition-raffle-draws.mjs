// scripts/apply-exhibition-raffle-draws.mjs
//
// Applies migrations/add-exhibition-raffle-draws.sql — the table that records
// every raffle spin (season, qualifying amount, finalists, winner, time).
//
//   node scripts/apply-exhibition-raffle-draws.mjs --apply
//
// Without --apply this is a dry run: it reports whether the table already
// exists and changes nothing. The DDL itself is idempotent.
//
// Env: SUPABASE_DB_URL from .env.local / .env.local.remote / .env.
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

const apply = process.argv.slice(2).includes('--apply')
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const exists = await c.query(`select to_regclass('public.exhibition_raffle_draws') as t`)
console.log(`exhibition_raffle_draws: ${exists.rows[0]?.t ? 'present' : 'missing'}`)

if (!apply) {
  console.log('dry run — re-run with --apply to create the table.')
  await c.end()
  process.exit(0)
}

const sql = fs.readFileSync('migrations/add-exhibition-raffle-draws.sql', 'utf8')
await c.query(sql)
console.log('applied migrations/add-exhibition-raffle-draws.sql')

const check = await c.query(`
  select column_name, data_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'exhibition_raffle_draws'
  order by ordinal_position
`)
console.log(`columns: ${check.rows.map((r) => r.column_name).join(', ')}`)

await c.end()
