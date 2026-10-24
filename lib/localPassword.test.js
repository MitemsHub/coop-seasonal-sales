// lib/localPassword.test.js
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './localPassword'

describe('localPassword', () => {
  it('hashes and verifies a password', () => {
    const h = hashPassword('correct horse battery')
    expect(h.startsWith('$scrypt$')).toBe(true)
    expect(verifyPassword('correct horse battery', h)).toBe(true)
  })

  it('rejects a wrong password', () => {
    const h = hashPassword('secret123')
    expect(verifyPassword('secret124', h)).toBe(false)
    expect(verifyPassword('', h)).toBe(false)
  })

  it('never produces the same hash twice (random salt)', () => {
    const a = hashPassword('samepassword')
    const b = hashPassword('samepassword')
    expect(a).not.toBe(b)
    expect(verifyPassword('samepassword', a)).toBe(true)
    expect(verifyPassword('samepassword', b)).toBe(true)
  })

  it('rejects passwords shorter than 6 characters', () => {
    expect(() => hashPassword('abc')).toThrow()
  })

  it('is safe on malformed stored hashes', () => {
    expect(verifyPassword('x', '')).toBe(false)
    expect(verifyPassword('x', 'garbage')).toBe(false)
    expect(verifyPassword('x', '$scrupt$1$1$1$aa$bb')).toBe(false)
  })
})
