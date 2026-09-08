// lib/directDb.js
// Direct PostgreSQL connection using transaction pooler
import { Pool } from 'pg'

let pool = null

// Local Postgres (docker / localhost / private net) usually has no TLS — keep
// SSL for remote Supabase connections only. The URL can force the behaviour
// explicitly with ?sslmode=disable or ?sslmode=require.
export function isLocalPostgresUrl(dbUrl) {
  try {
    const u = new URL(dbUrl)
    const sslmode = u.searchParams.get('sslmode')
    if (sslmode === 'disable') return true
    if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') return false

    const host = (u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
    // Private ranges: 10.x, 172.16-31.x, 192.168.x
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
    // Single-label hostnames (e.g. docker-compose service names like "coop-pg")
    // are local to the compose network; remote Supabase hosts are always FQDNs.
    if (!host.includes('.')) return true
    return false
  } catch {
    return /(127\.0\.0\.1|localhost)(:|\/)/.test(dbUrl || '')
  }
}

// Initialize connection pool
function getPool() {
  if (!pool) {
    const dbUrl = process.env.SUPABASE_DB_URL
    
    if (!dbUrl) {
      throw new Error('SUPABASE_DB_URL environment variable is not set')
    }
    
    pool = new Pool({
      connectionString: dbUrl,
      ssl: isLocalPostgresUrl(dbUrl) ? false : { rejectUnauthorized: false },
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 12000, // Allow up to 12 seconds for initial connection (Supabase TLS + pooler)
    })

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err)
    })
    // Initialize per-connection settings to prevent long-running queries from crashing the route
    pool.on('connect', async (client) => {
      try {
        // 20s per statement, 10s idle in transaction; helps avoid server-side termination under load
        await client.query('SET statement_timeout TO 20000')
        await client.query('SET idle_in_transaction_session_timeout TO 10000')
      } catch (e) {
        console.warn('directDb: failed to set timeouts on new connection:', e?.message)
      }
    })
  }
  return pool
}

// Execute a query using the direct database connection
export async function queryDirect(text, params = []) {
  const client = await getPool().connect()
  try {
    const result = await client.query(text, params)
    return result
  } catch (error) {
    console.error('Direct database query error:', error)
    throw error
  } finally {
    client.release()
  }
}

// Run a callback inside BEGIN … COMMIT with a PostgreSQL advisory lock.
// Uses pg_advisory_xact_lock (transaction-scoped) so the lock is released
// automatically on COMMIT / ROLLBACK — no connection leak.
//
// lockKey: any integer; routes sharing the same key serialize, different
// keys run concurrently.  Pass a stable constant (e.g. a hash of the
// table name) rather than a random value.
//
// callback receives (queryFn) where queryFn(text, params) runs on the
// same client+transaction.
//
// Example:
//   const result = await transactionalQuery(12345, async (q) => {
//     await q('BEGIN')
//     const { rows } = await q('SELECT id FROM foo WHERE x = $1 FOR UPDATE', [x])
//     if (rows.length) await q('UPDATE foo SET y = 1 WHERE id = $1', [rows[0].id])
//     else await q('INSERT INTO foo (x, y) VALUES ($1, 1)', [x])
//     await q('COMMIT')
//     return rows
//   })
export async function transactionalQuery(lockKey, callback) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey])
    const queryFn = (text, params) => client.query(text, params)
    const result = await callback(queryFn)
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    console.error('transactionalQuery error:', error)
    throw error
  } finally {
    client.release()
  }
}