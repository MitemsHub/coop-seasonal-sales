// scripts/diag-reviews.mjs
// READ-ONLY live check of member_reviews — the source of the landing page's
// Member Stories / testimonials. Answers the admin's two questions:
//   1. Why do testimonials look duplicated? (identical quote/member rows)
//   2. Why do some cards come without a name? (empty reviewer_name/branch_name)
// Usage: node scripts/diag-reviews.mjs
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

const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

try {
  const q = async (sql, params = []) => (await c.query(sql, params)).rows

  console.log('─'.repeat(64))
  console.log('1) member_reviews overview')
  const o = (await q(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE approved) AS approved,
            count(*) FILTER (WHERE NOT approved) AS pending,
            count(*) FILTER (WHERE coalesce(reviewer_name, '') = '') AS no_name,
            count(*) FILTER (WHERE coalesce(branch_name, '') = '') AS no_branch,
            count(*) FILTER (WHERE coalesce(review_text, '') = '') AS no_text
       FROM public.member_reviews`
  ))[0]
  console.log(`   total: ${o.total} · approved: ${o.approved} · pending: ${o.pending}`)
  console.log(`   empty reviewer_name: ${o.no_name} · empty branch_name: ${o.no_branch} · empty review_text: ${o.no_text}`)

  console.log('─'.repeat(64))
  console.log('2) Rows grouped by member + review text — anything repeated shows up here')
  const dupes = await q(
    `SELECT member_id, r.reviewer_name, regexp_replace(btrim(r.review_text), '\\s+', ' ', 'g') AS quote,
            count(*) AS times, string_agg(to_char(r.created_at, 'YYYY-MM-DD HH24:MI'), ' | ') AS when
       FROM public.member_reviews r
      GROUP BY member_id, r.reviewer_name, regexp_replace(btrim(r.review_text), '\\s+', ' ', 'g')
     HAVING count(*) > 1`
  )
  if (dupes.length === 0) console.log('   none — no duplicated member+quote rows')
  for (const d of dupes) {
    console.log(`   ${d.times}× member ${d.member_id} (${d.reviewer_name || 'NO NAME'}): "${String(d.quote).slice(0, 80)}" — ${d.when}`)
  }

  console.log('─'.repeat(64))
  console.log('3) What the landing page actually shows (latest 20 approved, as the API returns them)')
  const rows = await q(
    `SELECT r.id, r.member_id, r.rating, r.reviewer_name, r.branch_name,
            left(regexp_replace(btrim(r.review_text), '\\s+', ' ', 'g'), 60) AS quote,
            to_char(r.created_at, 'YYYY-MM-DD HH24:MI') AS when
       FROM public.member_reviews r
      WHERE (r.approved IS TRUE OR r.approved IS NULL)
      ORDER BY r.created_at DESC
      LIMIT 20`
  )
  const seen = new Set()
  for (const r of rows) {
    const key = `${r.member_id}|${r.quote || ''}`
    const flag = seen.has(key) ? '  <-- SAME member, SAME quote already seen (duplicate)' : ''
    seen.add(key)
    console.log(`   #${r.id} · member ${r.member_id} · ${r.reviewer_name || 'NO NAME'} · ${r.branch_name || 'NO BRANCH'} · ${r.rating}★ · "${r.quote}"${flag}`)
  }

  console.log('─'.repeat(64))
  console.log('4) Buffer check: can missing names be filled from the members table?')
  const fillable = await q(
    `SELECT count(*) AS fillable FROM public.member_reviews r
       LEFT JOIN public.members m ON m.member_id = r.member_id
      WHERE coalesce(r.reviewer_name, '') = '' AND coalesce(m.full_name, '') <> ''`
  )
  console.log(`   reviews with empty reviewer_name but a matching members.full_name: ${fillable[0].fillable}`)
} finally {
  await c.end()
}
