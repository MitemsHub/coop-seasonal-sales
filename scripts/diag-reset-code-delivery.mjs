// scripts/diag-reset-code-delivery.mjs
// READ-ONLY. Explains why a password-reset code sometimes never arrives.
//
// Three independent questions:
//   1. Which members can NEVER receive a code (the route silently returns
//      { ok: true } for them without sending anything)?
//   2. For members who do reach the send, did GoTrue actually create a code?
//      auth.one_time_tokens holds the live 6-digit code; recovery_sent_at
//      holds the last time the recovery email was handed to SMTP.
//   3. How fresh are those codes — i.e. is the mail system being asked to
//      deliver and going quiet, or is the send never happening?
//
// Prints no email addresses in full and no tokens.
import 'dotenv/config'
import fs from 'node:fs'
import pg from 'pg'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}

const conn = process.env.SUPABASE_DB_URL
if (!conn) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }
// Which database are we talking to? Print the host only — never credentials.
try { console.log('host:', new URL(conn).host, '\n') } catch { console.log('host: (non-url connection string)\n') }

const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (sql, params = []) => (await c.query(sql, params)).rows

const mask = (e) => {
  if (!e) return null
  const [u, d] = String(e).split('@')
  if (!d) return '***'
  return `${u.slice(0, 2)}***@${d}`
}

try {
  console.log('=== 1. Members that can never receive a code ===')
  const cohorts = await q(`
    SELECT
      count(*) FILTER (WHERE portal_enabled IS DISTINCT FROM false) AS in_cohort,
      count(*) FILTER (WHERE portal_enabled IS DISTINCT FROM false AND auth_user_id IS NULL) AS no_auth_account,
      count(*) FILTER (WHERE portal_enabled IS DISTINCT FROM false AND auth_user_id IS NOT NULL AND (email IS NULL OR btrim(email)='')) AS no_email,
      count(*) FILTER (WHERE portal_enabled IS DISTINCT FROM false AND auth_user_id IS NOT NULL AND email IS NOT NULL AND btrim(email)<>'' AND coalesce(alternative_email,'') <> '') AS has_alt_email,
      count(*) FILTER (WHERE portal_enabled IS false) AS out_of_cohort
    FROM members
  `)
  console.table(cohorts[0])

  console.log('=== 2. Auth accounts behind those member rows ===')
  const auth = await q(`
    SELECT
      count(*) AS members_with_auth,
      count(*) FILTER (WHERE u.id IS NULL) AS auth_user_id_dangling,
      count(*) FILTER (WHERE u.email_confirmed_at IS NULL) AS never_confirmed,
      count(*) FILTER (WHERE u.banned_until IS NOT NULL) AS banned
    FROM members m
    LEFT JOIN auth.users u ON u.id = m.auth_user_id
    WHERE m.portal_enabled IS DISTINCT FROM false
      AND m.auth_user_id IS NOT NULL
  `)
  console.table(auth[0])

  console.log('=== 3. Last recovery sends (auth.users.recovery_sent_at) ===')
  const rec = await q(`
    SELECT
      count(*) FILTER (WHERE recovery_sent_at IS NOT NULL) AS ever_sent,
      count(*) FILTER (WHERE recovery_sent_at > now() - interval '7 days') AS sent_last_7d,
      count(*) FILTER (WHERE recovery_sent_at > now() - interval '24 hours') AS sent_last_24h,
      count(*) FILTER (WHERE recovery_sent_at > now() - interval '7 days'
                         AND email_confirmed_at IS NULL) AS sent_but_unconfirmed
    FROM auth.users
  `)
  console.table(rec[0])

  console.log('=== 4. Codes GoTrue is currently holding (auth.one_time_tokens) ===')
  const ott = await q(`
    SELECT count(*) AS live_codes,
           count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS created_last_24h,
           min(created_at) AS oldest,
           max(created_at) AS newest
    FROM auth.one_time_tokens
  `)
  console.table(ott[0])

  console.log('=== 5. Recovery sends vs codes still live in the last 3 days ===')
  const recent = await q(`
    SELECT to_char(recovery_sent_at, 'YYYY-MM-DD HH24:MI') AS recovery_sent_at_utc
    FROM auth.users
    WHERE recovery_sent_at > now() - interval '3 days'
    ORDER BY recovery_sent_at DESC
    LIMIT 15
  `)
  if (recent.length) console.table(recent)
  else console.log('(no recovery sends recorded in the last 3 days)')

  console.log('=== 6. Do recent codes still exist where a recent send happened? ===')
  const link = await q(`
    SELECT
      to_char(u.recovery_sent_at, 'YYYY-MM-DD HH24:MI') AS recovery_sent_at_utc,
      count(t.id) AS live_codes,
      max(t.created_at) AS newest_code
    FROM auth.users u
    LEFT JOIN auth.one_time_tokens t ON t.user_id = u.id
    WHERE u.recovery_sent_at > now() - interval '3 days'
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 15
  `)
  if (link.length) console.table(link)
  else console.log('(no rows)')

  console.log('=== 7. Members with an alternative email (2 sends per request) ===')
  const alt = await q(`
    SELECT count(*) AS members_with_alt_email
    FROM members
    WHERE portal_enabled IS DISTINCT FROM false
      AND auth_user_id IS NOT NULL
      AND coalesce(alternative_email,'') <> ''
      AND lower(btrim(alternative_email)) IS DISTINCT FROM lower(btrim(email))
  `)
  console.table(alt[0])
} catch (e) {
  console.error('diag failed:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
