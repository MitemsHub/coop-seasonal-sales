// APPLY + VERIFY — apply migrations/fix-food-retiree-savings-rule.sql to live,
// then confirm the live definition matches the migration file exactly.
import fs from 'node:fs'
import pg from 'pg'
import 'dotenv/config'

if (!process.env.SUPABASE_DB_URL) {
  for (const f of ['.env.local', '.env.local.remote', '.env']) {
    try {
      const t = fs.readFileSync(f, 'utf8')
      const m = t.match(/^SUPABASE_DB_URL=(.*)$/m)
      if (m) { process.env.SUPABASE_DB_URL = m[1].replace(/^["']|["']$/g, ''); break }
    } catch {}
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('No SUPABASE_DB_URL found'); process.exit(1) }

const sql = fs.readFileSync('migrations/fix-food-retiree-savings-rule.sql', 'utf8')
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })

try {
  await pool.query(sql)
  console.log('APPLIED fix-food-retiree-savings-rule.sql to live')

  // Verify: live def must equal the migration body (function part of the file)
  const { rows } = await pool.query(`SELECT pg_get_functiondef('public.create_food_order_atomic(text,text,text,integer,integer,integer,text,numeric,integer,jsonb,boolean,numeric)'::regprocedure) AS def`)
  const liveDef = rows[0].def
  const fileFnStart = fs.readFileSync('migrations/fix-food-retiree-savings-rule.sql', 'utf8').indexOf('CREATE OR REPLACE FUNCTION')
  const fileFn = fs.readFileSync('migrations/fix-food-retiree-savings-rule.sql', 'utf8').slice(fileFnStart).trim()
  const liveTrim = liveDef.trim()
  if (liveTrim === fileFn) {
    console.log('VERIFY: live definition matches migration file EXACTLY (byte-for-byte)')
  } else {
    // Report the first differing line to diagnose
    const a = liveTrim.split('\n'); const b = fileFn.split('\n')
    let i = 0
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
    console.log(`VERIFY MISMATCH at line ${i + 1}:`)
    console.log('  live   :', JSON.stringify(a[i]))
    console.log('  file   :', JSON.stringify(b[i]))
    console.log('  (live lines:', a.length, '| file lines:', b.length, ')')
  }
} finally {
  await pool.end()
}
