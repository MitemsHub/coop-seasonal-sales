// lib/localPassword.js
// Local (non-Supabase) password hashing for members who sign in WITHOUT an
// email account — pensioners ("P"-prefixed member IDs). An admin sets the
// password on the member record; the member logs in with Staff ID + password
// and the server verifies against this hash instead of Supabase Auth.
//
// Format: $scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>
// Uses Node's built-in crypto.scryptSync — no external dependency.
import crypto from 'node:crypto'

const KEYLEN = 64
const DEFAULTS = { N: 16384, r: 8, p: 1 }

export function hashPassword(password) {
  const pw = String(password || '')
  if (pw.length < 6) throw new Error('Password must be at least 6 characters')
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, KEYLEN, DEFAULTS)
  return `$scrypt$${DEFAULTS.N}$${DEFAULTS.r}$${DEFAULTS.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$')
    if (parts[1] !== 'scrypt') return false
    const N = parseInt(parts[2], 10)
    const r = parseInt(parts[3], 10)
    const p = parseInt(parts[4], 10)
    const salt = Buffer.from(parts[5], 'base64')
    const hash = Buffer.from(parts[6], 'base64')
    const candidate = crypto.scryptSync(String(password || ''), salt, hash.length, { N, r, p })
    return crypto.timingSafeEqual(candidate, hash)
  } catch {
    return false
  }
}
