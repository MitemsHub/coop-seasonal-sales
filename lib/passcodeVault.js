// lib/passcodeVault.js
// Vendor passcodes are stored as scrypt hashes so the database never holds the
// credential a vendor signs in with. That protects the accounts, but it also
// means an admin cannot read back the passcode a vendor was sent — the "View
// login" sheet could only issue a new one.
//
// Keep a second copy encrypted with a key derived from APP_SECRET. The hash
// stays the source of truth for signing in; this copy exists only to be shown
// to an authenticated admin, and is useless without the server secret (so
// database read access alone does not reveal passcodes).
//
// Format: v1.<ivHex>.<tagHex>.<cipherHex>
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto'

const PREFIX = 'v1'
const KEY_INFO = 'vendor-passcode-vault:v1'
const IV_BYTES = 12
const TAG_BYTES = 16

function vaultKey(secret) {
  const value = String(secret || process.env.APP_SECRET || '')
  if (!value) throw new Error('APP_SECRET is required to keep a recoverable copy of vendor passcodes')
  return createHmac('sha256', value).update(KEY_INFO).digest()
}

export function encryptPasscode(plain, secret) {
  const value = String(plain || '')
  if (!value) throw new Error('Passcode cannot be empty')
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', vaultKey(secret), iv)
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [PREFIX, iv.toString('hex'), cipher.getAuthTag().toString('hex'), body.toString('hex')].join('.')
}

// Returns null instead of throwing: a missing copy is a normal state (passcodes
// issued before this existed), and a rotated APP_SECRET or a tampered value
// must not break the admin page.
export function decryptPasscode(record, secret) {
  const parts = String(record || '').split('.')
  if (parts.length !== 4 || parts[0] !== PREFIX) return null
  try {
    const iv = Buffer.from(parts[1], 'hex')
    const tag = Buffer.from(parts[2], 'hex')
    const body = Buffer.from(parts[3], 'hex')
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null
    const decipher = createDecipheriv('aes-256-gcm', vaultKey(secret), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// Best-effort variant for paths (vendor sign-in) that must keep working even
// when no secret is configured or the migration has not run yet.
export function tryEncryptPasscode(plain, secret) {
  try {
    return encryptPasscode(plain, secret)
  } catch {
    return null
  }
}

// PostgREST reports an unknown column as 42703. Callers retry without the
// encrypted copy so vendor management keeps working before the migration runs.
export function isMissingEncryptedColumn(error) {
  return (
    String(error?.code || '') === '42703' &&
    String(error?.message || '').includes('passcode_encrypted')
  )
}

// Save a passcode record (create, import, reset), then retry once without the
// sealed copy if add-exhibition-vendor-passcode-encrypted.sql has not run yet.
// Losing the readable copy is much better than losing the vendor: the scrypt
// hash and its uniqueness fingerprint still save, and admins simply cannot
// read that passcode back until the next reset.
//
// `run` takes the row to write and returns Supabase's `{ data, error }`.
export async function withPasscodeFallback(record, run) {
  const first = await run(record)
  if (!isMissingEncryptedColumn(first?.error)) return first

  const legacy = { ...record }
  delete legacy.passcode_encrypted
  return run(legacy)
}
