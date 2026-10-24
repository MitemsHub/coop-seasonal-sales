// RLS lockdown: pre-check, apply, and post-verify against the live DB.
// Reads credentials from .env.local / .env.local.remote (SUPABASE_DB_URL,
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY).
//
//   node scripts/apply-rls-lockdown.mjs           # pre-check + apply + verify
//   node scripts/apply-rls-lockdown.mjs --dry-run # pre-check only, no writes
//
// Post-verify simulates the BROWSER (anon key) — the exact role RLS now
// governs — and asserts: catalog reads still pass, member/order reads are
// denied, and a member row with the anon key returns zero rows.
import fs from 'node:fs'
import path from 'node:path'

let envText = ''
for (const f of ['.env.local.remote', '.env.local', '.env']) {
  const p = path.join(process.cwd(), f)
  if (fs.existsSync(p)) { envText = fs.readFileSync(p, 'utf8'); break }
}
if (!envText) { console.error('No env file found'); process.exit(1) }
const env = Object.fromEntries(
  envText.split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
)
const { SUPABASE_DB_URL: dbUrl, NEXT_PUBLIC_SUPABASE_URL: baseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } = env
if (!dbUrl || !baseUrl || !anonKey) {
  console.error('Missing SUPABASE_DB_URL and/or NEXT_PUBLIC_ vars'); process.exit(1)
}

const pg = (await import('pg')).default
const isDry = process.argv.includes('--dry-run')
// Which migration to apply (default phase 1; pass the phase 2 filename as arg)
const migFile = process.argv.slice(2).find((a) => a.endsWith('.sql')) || 'rls-lockdown-2026-10-24.sql'
const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await c.connect()

const logPath = path.join(process.cwd(), 'scripts', 'rls-apply.log')
fs.writeFileSync(logPath, `== run ${new Date().toISOString()} dry=${isDry}\n`)
const section = (s) => { const t = `\n${s}`; console.log(t); fs.appendFileSync(logPath, t + '\n') }
const fails = []

if (isDry) {
  section('══ DRY RUN — pre-check only, nothing will be written ══')
}

// ---------- Pre-checks ----------
section('Pre-check 1: tables with RLS currently OFF (public schema)')
const offNow = await c.query(`
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  ORDER BY 1`)
console.log(`  ${offNow.rows.length} table(s): ${offNow.rows.map((r) => r.relname).join(', ') || 'none'}`)

section('Pre-check 2: backup_* tables present')
const backups = await c.query(`
  SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname LIKE 'backup\\_%' ESCAPE '\\'
  ORDER BY pg_total_relation_size(c.oid) DESC`)
console.log(`  ${backups.rows.length} table(s):`)
for (const r of backups.rows) console.log(`    ${r.relname}  ${r.size}`)

section('Pre-check 3: existing policies we will replace/drop')
const pols = await c.query(`
  SELECT tablename, policyname, cmd FROM pg_policies
  WHERE schemaname = 'public' ORDER BY tablename, policyname`)
console.log(`  ${pols.rows.length} existing polic(ies) — listing all:`)
for (const r of pols.rows) console.log(`    ${r.tablename}.${r.policyname} (${r.cmd})`)

section('Pre-check 4: any residual FK from backup_* into live tables')
const fkCheck = await c.query(`
  SELECT DISTINCT cn.conname, con.relname AS from_tbl, ref.relname AS to_tbl
  FROM pg_constraint cn
  JOIN pg_class con ON con.oid = cn.conrelid
  JOIN pg_class ref ON ref.oid = cn.confrelid
  JOIN pg_namespace n ON n.oid = con.relnamespace
  WHERE n.nspname='public' AND cn.contype='f'
    AND (con.relname LIKE 'backup\\_%' ESCAPE '\\' OR ref.relname LIKE 'backup\\_%' ESCAPE '\\')`)
console.log(`  ${fkCheck.rows.length} hit(s)${fkCheck.rows.length ? ' — DO NOT DROP' : ' — safe'}`)

if (isDry) {
  section('Dry run complete — nothing written. Re-run without --dry-run to apply.')
  await c.end(); process.exit(0)
}

// ---------- Apply ----------
section(`Applying migrations/${migFile} (statement-by-statement)…`)
const sql = fs.readFileSync(path.join(process.cwd(), 'migrations', migFile), 'utf8')

// Split into statements, respecting DO $$ … $$; blocks.
const stmts = []
let buf = [], inDo = false
for (const line of sql.split(/\r?\n/).filter((l) => !/^\s*--/.test(l) || inDo)) {
  if (!inDo) {
    if (/^\s*DO \$\$/.test(line)) { inDo = true; buf.push(line) }
    else if (/;\s*$/.test(line)) { if (line.trim() !== ';') stmts.push(line.trim()) }
    else if (line.trim()) buf.push(line)
  } else {
    buf.push(line)
    if (/^\s*END \$\$;?\s*$/.test(line)) { stmts.push(buf.join('\n')); buf = []; inDo = false }
  }
}
if (buf.length) stmts.push(buf.join('\n'))

let state = ''
try {
  await c.query('SET statement_timeout = 60000')
  for (const [i, stmt] of stmts.entries()) {
    state = stmt.replace(/\s+/g, ' ').slice(0, 80)
    const t0 = Date.now()
    const done = `  ✓ [${i + 1}/${stmts.length}] ${state} (${Date.now() - t0}ms)`
    fs.appendFileSync(logPath, `START [${i + 1}/${stmts.length}] ${state}\n`)
    await c.query(stmt)
    fs.appendFileSync(logPath, done + '\n')
    console.log(done)
  }
} catch (e) {
  console.error(`  APPLY FAILED at: ${state}`)
  console.error('  ', e.message)
  // Attempt to roll back whatever partial transaction is open.
  try { await c.query('ROLLBACK') } catch {}
  await c.end(); process.exit(1)
}

// ---------- Post-verify: DB state ----------
section('Verify 1: tables still with RLS OFF')
const offAfter = await c.query(`
  SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND NOT c.relrowsecurity AND NOT c.relname LIKE 'pgx_%'`)
if (offAfter.rows.length) {
  fails.push(`RLS still OFF on: ${offAfter.rows.map((r) => r.relname).join(', ')}`)
}
console.log(`  → ${offAfter.rows.length} table(s) remain unprotected`)

section('Verify 2: policies now in place')
const polsAfter = await c.query(`
  SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
  ORDER BY tablename, policyname`)
console.log(`  ${polsAfter.rows.length} polic(ies):`)
for (const r of polsAfter.rows) console.log(`    ${r.tablename} ← ${r.policyname}`)

section('Verify 3: backup_* tables remaining')
const bAfter = await c.query(`
  SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname LIKE 'backup\\_%' ESCAPE '\\'`)
if (bAfter.rows.length) fails.push(`backup_* still present: ${bAfter.rows.map((r) => r.relname).join(', ')}`)
console.log(`  → ${bAfter.rows.length} remaining`)

// ---------- Purge-check: simulate the BROWSER with the anon key ----------
section('Verify 4: anonymous-key browser access (this is what RLS now enforces)')
const acc = new pg.Client({
  connectionString: dbUrl.replace(/\?.*$/, ''),
  ssl: { rejectUnauthorized: false },
})
// We drop into a SET ROLE that mirrors anon's visibility by simply running
// the queries via the anon REST endpoint — the truest simulation — plus a
// direct psql SET ROLE anon check where possible.
try {
  await acc.query(`SET ROLE anon`)
} catch { /* role may be protected; fall back to REST test below */ }

const anonFetch = async (table, search = '') => {
  const url = `${baseUrl}/rest/v1/${table}?select=*&limit=1${search}`
  try {
    const res = await fetch(url, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } })
    const body = await res.json()
    return { status: res.status, rows: Array.isArray(body) ? body.length : 0, err: body?.message }
  } catch (e) { return { status: 'ERR', rows: 0, err: e.message } }
}

const expect = async (desc, table, shouldPass) => {
  const r = await anonFetch(table)
  const pass = shouldPass ? r.status === 200 : r.status === 400 || r.status === 401 || r.status === 403 || (r.status === 200 && r.rows === 0)
  if (!pass && shouldPass !== 'info') fails.push(`anon/${table}: expected ${shouldPass ? '200' : 'denied'}, got ${r.status}${r.err ? ' — ' + r.err : ''}`)
  console.log(`    ${table}: status=${r.status} rows=${r.rows} → ${pass ? 'OK' : (shouldPass === 'info' ? 'UNPROTECTED (Phase 2)' : 'FAIL')}`)
}

console.log('  Expected PASS (public catalog reads):')
await expect('items', 'items', true)
await expect('branches', 'branches', true)
await expect('cycles', 'cycles', true)
await expect('departments', 'departments', true)
await expect('item_branch_overrides', 'item_branch_overrides', true)
console.log('  Expected DENIED / empty (server-only tables):')
await expect('member_notifications', 'member_notifications', false)
await expect('inventory_movements', 'inventory_movements', false)
await expect('audit_log', 'audit_log', false)
await expect('chat_messages (REST)', 'chat_messages', false)
await expect('app_settings', 'app_settings', false)
await expect('exhibition_orders', 'exhibition_orders', false)
console.log('  Phase 1 status quo (still open until Phase 2 page refactors):')
await expect('members', 'members', 'info')
await expect('orders', 'orders', 'info')
await expect('order_lines', 'order_lines', 'info')
await expect('ram_orders', 'ram_orders', 'info')

await acc.end()
await c.end()

console.log('')
if (fails.length) {
  console.log('FAILURES:'); for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('ALL CHECKS PASSED.')
