// scripts/apply-member-cohort.mjs
// One-off cohort switch for the member portal.
//
// Backdrop: the coop wants the member portal to only recognize members that
// exist in the latest official member import. The import can't be identified
// from created_at alone (11,293 rows matched pre-existing rows), so the
// cooperating admin supplies the authoritative member-ID list and this script
// tags the database: portal_enabled = TRUE for listed members, FALSE for
// everyone else.
//
// Usage:
//   node scripts/apply-member-cohort.mjs <ids-file> [--apply]
//
// <ids-file> accepts:
//   .xlsx / .xls  — first sheet; reads the member_id column if present, else
//                   the first column
//   .csv          — same header logic (member_id column if present, else first)
//   anything else — treated as plain text, one member ID per line
//
// By default this is a DRY RUN: nothing is written; it reports what would
// change, including the members that would be excluded. Pass --apply to write.
// Existing accounts keep the option to be re-enabled later by re-running the
// members import (import sets portal_enabled = TRUE).
//
// Env: SUPABASE_DB_URL (loaded from .env.local / .env.local.remote / .env).
import fs from 'node:fs'
import path from 'node:path'

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

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const fileArg = args.filter((a) => !a.startsWith('--'))[0]
if (!fileArg) {
  console.error('Usage: node scripts/apply-member-cohort.mjs <ids-file> [--apply]')
  process.exit(1)
}
const filePath = path.resolve(fileArg)
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`)
  process.exit(1)
}

// ── Load the ID list ────────────────────────────────────────────────────────
let idsRaw = []
const ext = path.extname(filePath).toLowerCase()
if (ext === '.xlsx' || ext === '.xls') {
  const XLSX = (await import('xlsx/xlsx.mjs')).default ?? (await import('xlsx/xlsx.mjs'))
  const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  for (const r of rows) {
    const v =
      r.member_id != null && String(r.member_id).trim() !== ''
        ? String(r.member_id)
        : Object.values(r)[0]
    idsRaw.push(v)
  }
} else if (ext === '.csv') {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)
  const first = lines[0]?.split(',')[0]?.trim().toLowerCase() || ''
  const start = first === 'member_id' ? 1 : 0
  for (let i = start; i < lines.length; i++) idsRaw.push(lines[i].split(',')[0])
} else {
  idsRaw = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
}

// Normalize: uppercase, trim, drop empties; keep first occurrence of dupes
const listed = []
for (const raw of idsRaw) {
  const id = String(raw ?? '').trim().toUpperCase()
  if (id && !listed.includes(id)) listed.push(id)
}
if (!listed.length) {
  console.error('No member IDs found in the file.')
  process.exit(1)
}

// ── Connect ────────────────────────────────────────────────────────────────
if (!process.env.SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL not set (check .env.local / .env).')
  process.exit(1)
}
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

try {
  // Stash the list in a TEMP table so the whole swap stays set-based
  await c.query('CREATE TEMP TABLE cohort_ids (member_id TEXT PRIMARY KEY)')
  const CHUNK = 500
  for (let i = 0; i < listed.length; i += CHUNK) {
    const part = listed.slice(i, i + CHUNK)
    const values = []
    const params = []
    part.forEach((id, j) => {
      values.push(`($${j + 1})`)
      params.push(id)
    })
    await c.query(
      `INSERT INTO cohort_ids (member_id) VALUES ${values.join(', ')} ON CONFLICT (member_id) DO NOTHING`,
      params
    )
  }

  const listedInDb = await c.query(
    'SELECT count(*) n FROM cohort_ids ci JOIN members m ON m.member_id = ci.member_id'
  )
  const notFound = listed.length - Number(listedInDb.rows[0].n)
  const currentlyEnabled = await c.query('SELECT count(*) n FROM members WHERE portal_enabled')

  const toDisable = await c.query(
    `SELECT count(*) n FROM members m WHERE m.portal_enabled AND NOT EXISTS
       (SELECT 1 FROM cohort_ids ci WHERE ci.member_id = m.member_id)`
  )
  const toEnable = await c.query(
    `SELECT count(*) n FROM members m WHERE NOT m.portal_enabled AND EXISTS
       (SELECT 1 FROM cohort_ids ci WHERE ci.member_id = m.member_id)`
  )
  // Sample of members that would be excluded — for human review before --apply
  const sample = await c.query(
    `SELECT m.member_id, m.full_name, m.grade FROM members m
     WHERE m.portal_enabled AND NOT EXISTS (SELECT 1 FROM cohort_ids ci WHERE ci.member_id = m.member_id)
     ORDER BY m.member_id LIMIT 30`
  )

  console.log('─'.repeat(64))
  console.log(`Cohort file: ${filePath}`)
  console.log(`IDs in file (deduped): ${listed.length}`)
  console.log(`  matched in members:  ${listedInDb.rows[0].n}`)
  if (notFound > 0) console.log(`  NOT in members table: ${notFound} (typos / non-members; they are ignored)`)
  if (listedInDb.rows[0].n + notFound !== listed.length) console.log('  (mismatches: duplicate IDs already deduped)')
  console.log(`Current portal-enabled members: ${currentlyEnabled.rows[0].n}`)
  console.log(`Would ENABLE  ${toEnable.rows[0].n} member(s)  (currently excluded, listed in file)`)
  console.log(`would DISABLE ${toDisable.rows[0].n} member(s)  (currently active, not listed)`)
  if (Number(toDisable.rows[0].n) > 0 && Number(toDisable.rows[0].n) <= 50) {
    const all = await c.query(
      `SELECT m.member_id FROM members m
       WHERE m.portal_enabled AND NOT EXISTS (SELECT 1 FROM cohort_ids ci WHERE ci.member_id = m.member_id)
       ORDER BY m.member_id`
    )
    console.log('Members that would be disabled: ' + all.rows.map((r) => r.member_id).join(', '))
  } else if (Number(toDisable.rows[0].n) > 0) {
    console.log('First 30 that would be disabled:')
    for (const r of sample.rows) console.log(`  ${r.member_id} — ${r.full_name || ''} (${r.grade || ''})`)
  }
  console.log('─'.repeat(64))

  if (!apply) {
    console.log('DRY RUN — no changes written. Re-run with --apply to commit:')
    console.log(`  node scripts/apply-member-cohort.mjs ${fileArg} --apply`)
    process.exit(0)
  }

  await c.query('BEGIN')
  await c.query('UPDATE members SET portal_enabled = FALSE WHERE portal_enabled')
  for (let i = 0; i < listed.length; i += CHUNK) {
    const part = listed.slice(i, i + CHUNK)
    const values = []
    const params = []
    part.forEach((id, j) => {
      values.push(`($${j + 1})`)
      params.push(id)
    })
    await c.query(
      `UPDATE members m SET portal_enabled = TRUE
       FROM (VALUES ${values.join(', ')}) AS v(member_id)
       WHERE m.member_id = v.member_id`,
      params
    )
  }
  await c.query('COMMIT')

  const after = await c.query(
    'SELECT count(*) FILTER (WHERE portal_enabled) enabled, count(*) FILTER (WHERE NOT portal_enabled) disabled FROM members'
  )
  console.log(`APPLIED. portal_enabled TRUE for ${after.rows[0].enabled} member(s), FALSE for ${after.rows[0].disabled}.`)
} finally {
  await c.end()
}
