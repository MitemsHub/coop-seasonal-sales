// lib/passcodeHash.js
// Vendor passcodes are credentials. They used to be stored and compared in
// plaintext, so anyone with database read access (or a screenshot of the admin
// table) held every vendor's password. Store scrypt hashes instead and verify
// in constant time.
//
// Format: scrypt$<N>$<saltHex>$<hashHex>
// Legacy rows still contain plaintext. verifyPasscode() accepts those once and
// reports needsRehash so the caller can upgrade the row on a successful sign-in.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(scryptCb)

const N = 16384
const KEYLEN = 64
const PREFIX = 'scrypt'

export async function hashPasscode(plain) {
  const value = String(plain || '')
  if (!value) throw new Error('Passcode cannot be empty')
  const salt = randomBytes(16)
  const derived = await scrypt(value, salt, KEYLEN, { N })
  return `${PREFIX}$${N}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPasscode(plain, stored) {
  const value = String(plain || '')
  const record = String(stored || '')
  if (!value || !record) return { ok: false, needsRehash: false }

  const parts = record.split('$')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    // Legacy plaintext row — constant-time compare, then upgrade on success.
    const a = Buffer.from(value, 'utf8')
    const b = Buffer.from(record, 'utf8')
    const ok = a.length === b.length && timingSafeEqual(a, b)
    return { ok, needsRehash: ok }
  }

  const cost = Number(parts[1]) || N
  const salt = Buffer.from(parts[2], 'hex')
  const expected = Buffer.from(parts[3], 'hex')
  if (!salt.length || !expected.length) return { ok: false, needsRehash: false }

  const derived = await scrypt(value, salt, expected.length, { N: cost })
  const ok = derived.length === expected.length && timingSafeEqual(derived, expected)
  return { ok, needsRehash: false }
}
