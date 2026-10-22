// READ-ONLY diagnostic. Goal: find why outstandingLoansTotal > 0 for members
// whose members.loans = 0.  outstandingLoansTotal = loans + loanExposure from
// getCrossModuleExposure which queries orders + exhibition_orders for this
// year.  Checks:
//  1) supabase-js versions (vs known PGRST200 {or}/postal-codes regressions)
//  2) orders table this-year rows total (any member) to see if exposure could be nonzero
//  3) .next-dev server log files for postgrest/PGRST errors mentioning exposures
import fs from 'node:fs'
import path from 'node:path'
import 'dotenv/config'
if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try { const m = fs.readFileSync(f, 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m); if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^[\"']|[\"']$/g, ''); break } } catch {}
  }
}

console.log('══ 1 ═ supabase-js versions (PGRST200 or/limit regressions known in ×) —')
for (const p of ['node_modules/@supabase/supabase-js/package.json', 'node_modules/@supabase/postgrest-js/package.json']) {
  try { console.log(p, '=>', JSON.parse(fs.readFileSync(p, 'utf8')).version) } catch (e) { console.log(p, 'ERR', e.message.slice(0, 60)) }
}

console.log('')
console.log('══ 2 ═ orders rows this year —')
const pg = (await import('pg')).default
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const y = await c.query("SELECT COUNT(*)::int n, COALESCE(SUM(total_amount),0)::text amt FROM orders WHERE payment_option = 'Loan' AND created_at >= date_trunc('year', now())")
console.log(' Loan orders this year:', JSON.stringify(y.rows[0]))
const ey = await c.query("SELECT COUNT(*)::int n FROM exhibition_orders WHERE created_at >= date_trunc('year', now())").catch(e => { console.log(' exhibition_orders:', e.message.slice(0, 80)); return { rows: [{ n: 'n/a' }] } })
console.log(' Exhibition orders this year:', JSON.stringify(ey.rows[0]))

console.log('')
console.log('══ 3 ═ dev server stdout/stderr files mentioning PGRST or exposure —')
for (const dir of ['.', '.next-dev', '.next']) {
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.log'))) {
    try {
      const t = fs.readFileSync(path.join(dir, f), 'utf8')
      const lines = t.split('\n').filter((l) => /PGRST|postgrest|exposure|loanExposure/i.test(l))
      if (lines.length) console.log(dir + '/' + f + ':', lines.slice(-6).join('\n'))
    } catch {}
  }
}

console.log('')
console.log('══ 4 ═ Supabase auth session in dev env (.env flags mentioning GBP / postal / schema) —')
for (const f of ['.env.local', '.env.local.remote']) {
  try {
    const t = fs.readFileSync(f, 'utf8')
    const interesting = t.split('\n').filter((line) => /^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL)=/.test(line.trim()))
    for (const line of interesting) console.log(f, '=>', line.replace(/=(.*)$/, '=<redacted-host...>') )
  } catch {}
}

await c.end()
console.log('DONE — read only')
