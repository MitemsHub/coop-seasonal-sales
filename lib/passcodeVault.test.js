import { describe, expect, it } from 'vitest'
import {
  decryptPasscode,
  encryptPasscode,
  isMissingEncryptedColumn,
  tryEncryptPasscode,
} from './passcodeVault'

const SECRET = 'test-secret'

describe('passcode vault', () => {
  it('round-trips a passcode', () => {
    const sealed = encryptPasscode('K7Q2M9', SECRET)
    expect(sealed.startsWith('v1.')).toBe(true)
    expect(sealed).not.toContain('K7Q2M9')
    expect(decryptPasscode(sealed, SECRET)).toBe('K7Q2M9')
  })

  it('uses a fresh IV per record', () => {
    expect(encryptPasscode('ABCDEF', SECRET)).not.toBe(encryptPasscode('ABCDEF', SECRET))
  })

  it('returns null for a different secret or tampered ciphertext', () => {
    const sealed = encryptPasscode('K7Q2M9', SECRET)
    expect(decryptPasscode(sealed, 'another-secret')).toBeNull()
    const parts = sealed.split('.')
    parts[3] = 'ff' + parts[3].slice(2)
    expect(decryptPasscode(parts.join('.'), SECRET)).toBeNull()
  })

  it('treats missing or malformed records as no copy', () => {
    expect(decryptPasscode('', SECRET)).toBeNull()
    expect(decryptPasscode(null, SECRET)).toBeNull()
    expect(decryptPasscode('plaintext', SECRET)).toBeNull()
  })

  it('refuses to seal without a secret', () => {
    expect(() => encryptPasscode('K7Q2M9', '')).toThrow(/APP_SECRET/)
    expect(tryEncryptPasscode('K7Q2M9', '')).toBeNull()
  })

  it('recognises the missing-column error PostgREST returns', () => {
    expect(
      isMissingEncryptedColumn({ code: '42703', message: "column exhibition_vendors.passcode_encrypted does not exist" })
    ).toBe(true)
    expect(isMissingEncryptedColumn({ code: '23505', message: 'duplicate key' })).toBe(false)
  })
})
