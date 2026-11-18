import { describe, expect, it } from 'vitest'
import { passcodeLookup } from './passcodeHash'
import { generatePasscodeRecord } from './vendorCredentials'

const SECRET = 'test-passcode-lookup-secret'

describe('global vendor passcode uniqueness', () => {
  it('skips a passcode already fingerprinted for another vendor', () => {
    const takenLookups = new Set([passcodeLookup('K7Q2M9', SECRET)])
    let calls = 0
    const makePasscode = () => {
      calls += 1
      return calls === 1 ? 'K7Q2M9' : 'ABCDEF'
    }

    const result = generatePasscodeRecord({ takenLookups, makePasscode, secret: SECRET })

    expect(result.passcode).toBe('ABCDEF')
    expect(result.lookup).toBe(passcodeLookup('ABCDEF', SECRET))
    expect(takenLookups.has(result.lookup)).toBe(false)
    expect(calls).toBe(2)
  })

  it('keeps 500 generated passcodes unique against an existing vendor', () => {
    const takenLookups = new Set([passcodeLookup('K7Q2M9', SECRET)])

    for (let i = 0; i < 500; i += 1) {
      const { passcode, lookup } = generatePasscodeRecord({ takenLookups, secret: SECRET })
      expect(passcode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
      expect(takenLookups.has(lookup)).toBe(false)
      takenLookups.add(lookup)
    }

    expect(takenLookups.size).toBe(501)
  })
})
