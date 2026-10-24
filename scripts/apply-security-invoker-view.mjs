// Apply migrations/security-invoker-inventory-view-2026-10-25.sql to the live
// DB, then verify: security_invoker flag on, anon revoked, service reads work.
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
let envText = ''
for (const f of ['.env.local.remote', '.env.local', '.env']) {
  const p = path.join(root, f)
  if (fs.existsSync(p)) { envText = fs.readFileSync(p, 'utf8'); break }
}
const env = Object.fromEntries(
  envText.split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
)
const sql = fs.readFileSync(path.join(root, 'migrations', 'security-invoker-inventory-view-2026-10-25.sql'), 'utf8')
const stmts = sql
  .split(';')
  .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim())
  .filter((s) => s && !s.startsWith('--'))
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
for (const st of stmts) {
  console.log('>', st.slice(0, 90).replace(/\s+/g, ' '))
  const r = await c.query(st)
  console.log('  ok, rows:', r.rowCount)
}
const v = await c.query("select reloptions @> array['security_invoker=true'] AS invoker, reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='v_inventory_status'")
console.log('security_invoker =', v.rows[0]?.invoker)
const g = await c.query("select has_table_privilege('anon','public.v_inventory_status','SELECT') as anon_select")
console.log('anon SELECT on view =', g.rows[0]?.anon_select)
await c.end()
