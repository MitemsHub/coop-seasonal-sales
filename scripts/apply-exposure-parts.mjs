// scripts/apply-exposure-parts.mjs
// Applies migrations/exhibition-exposure-return-parts.sql.
//
// The function decides every exhibition loan limit, so this script records the
// definition it is replacing and then proves the change is additive: for a
// spread of members (active/senior, retiree, pensioner), loanEligible and
// outstandingLoansTotal must come out exactly as before, and any published
// loanSpaceParts must add back up to loanEligible.
//
//   node scripts/apply-exposure-parts.mjs            # dry run (report only)
//   node scripts/apply-exposure-parts.mjs --apply    # write it
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'

const APPLY = process.argv.includes('--apply')
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: false })
await client.connect()

const readDef = async () => {
  const { rows } = await client.query(
    `select pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'check_exhibition_exposure_atomic' and n.nspname = 'public'`
  )
  return rows[0]?.def || ''
}

const { rows: cycleRows } = await client.query(
  `select id from exhibition_cycles where status = 'active' order by created_at desc limit 1`
)
const cycleId = cycleRows[0]?.id
if (!cycleId) throw new Error('No active exhibition cycle — nothing to verify against.')

// One member per rule path, so every branch of the function is exercised.
const { rows: sample } = await client.query(
  `select member_id, category, grade from members
    where savings > 0
    order by case
      when lower(coalesce(category,'')) like 'r%' or lower(coalesce(category,'')) like '%retire%' then 0
      when lower(coalesce(category,'')) like 'p%' or lower(coalesce(category,'')) like '%pension%' then 1
      else 2 end,
      savings desc
    limit 40`
)
const picks = []
const seen = new Set()
for (const m of sample) {
  const group = /^r|retire/i.test(m.category || '')
    ? 'retiree'
    : /^p|pension/i.test(m.category || '')
      ? 'pensioner'
      : 'active'
  if (seen.has(group)) continue
  seen.add(group)
  picks.push({ ...m, group })
}
for (const group of ['retiree', 'pensioner', 'active']) {
  if (picks.some((p) => p.group === group)) continue
  const { rows } = await client.query(
    `select member_id, category, grade from members
      where savings > 0
        and case
          when lower(coalesce(category,'')) like 'r%' or lower(coalesce(category,'')) like '%retire%' then 'retiree'
          when lower(coalesce(category,'')) like 'p%' or lower(coalesce(category,'')) like '%pension%' then 'pensioner'
          else 'active' end = $1
      order by savings desc limit 1`,
    [group]
  )
  if (rows[0]) picks.push({ ...rows[0], group })
}
picks.push({ member_id: 'A25862', group: 'active' })
picks.push({ member_id: 'E00076', group: 'active' })

const call = async (memberId) => {
  const { rows } = await client.query(
    `select check_exhibition_exposure_atomic($1, 'Loan', 0, $2) as r`,
    [memberId, cycleId]
  )
  return rows[0].r
}

const before = new Map()
for (const m of picks) before.set(m.member_id, await call(m.member_id))

const backupDir = path.join('scripts', 'exposure-fn-backups')
fs.mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = path.join(backupDir, `check_exhibition_exposure_atomic_PRE-parts-${stamp}.sql`)
fs.writeFileSync(backupPath, await readDef())
console.log('backed up →', backupPath)

if (APPLY) {
  const sql = fs.readFileSync('migrations/exhibition-exposure-return-parts.sql', 'utf8')
  await client.query(sql)
  console.log('applied migrations/exhibition-exposure-return-parts.sql')
} else {
  console.log('dry run — pass --apply to write')
}

let bad = 0
for (const m of picks) {
  const after = await call(m.member_id)
  const prev = before.get(m.member_id)
  const same =
    prev?.ok === after?.ok &&
    Math.abs(Number(prev?.loanEligible || 0) - Number(after?.loanEligible || 0)) < 0.005 &&
    Math.abs(Number(prev?.outstandingLoansTotal || 0) - Number(after?.outstandingLoansTotal || 0)) < 0.005
  const parts = Array.isArray(after?.loanSpaceParts) ? after.loanSpaceParts : null
  let partsSum = null
  if (parts) {
    partsSum = parts.reduce(
      (sum, p, i) => (i === 0 || p.op !== '-' ? sum + Number(p.amount) : sum - Number(p.amount)),
      0
    )
  }
  const reconciles = parts ? Math.abs(partsSum - Number(after.loanEligible)) < 1 : true
  if (!same || !reconciles) bad++
  console.log(
    [
      m.member_id.padEnd(8),
      m.group.padEnd(9),
      same ? 'same' : 'CHANGED',
      `eligible ${Number(after?.loanEligible || 0).toLocaleString()}`,
      parts ? `parts ${parts.map((p) => `${p.op === '-' ? '− ' : ''}${p.label} ${Number(p.amount).toLocaleString()}`).join(' ')} = ${partsSum.toLocaleString()}` : 'parts (not published)',
      reconciles ? 'ok' : 'MISMATCH',
    ].join('  ')
  )
}

console.log(bad ? `FAILED: ${bad} member(s) disagree` : 'OK: behaviour unchanged, every published note reconciles')
await client.end()
if (bad) process.exitCode = 1
