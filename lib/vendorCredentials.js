// lib/vendorCredentials.js
// Admin batch-uploads vendors without thinking up logins: the system makes a
// short code (e.g. V0001) and a professional passcode (e.g. K7Q2M9).
// Passcodes are hashed before storage, so the plaintext only exists in the
// import result the admin sees.
import { randomInt } from 'crypto'
import { passcodeLookup } from './passcodeHash'

// Excludes ambiguous characters such as 0/O and 1/I.
const PASSCODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PASSCODE_LENGTH = 6

// V0001–V9999 — simple, readable, and globally unique because we skip any
// code already in use. The branch is stored separately on each vendor.
export function generateVendorCode({ taken = new Set() } = {}) {
  for (let n = 1; n <= 9999; n += 1) {
    const code = `V${String(n).padStart(4, '0')}`
    if (!taken.has(code)) return code
  }
  throw new Error('No vendor codes left. The V0001–V9999 range is full.')
}

// Six random characters from a 32-character alphabet. The caller passes a
// taken set so a batch or import cannot repeat a passcode.
export function generatePasscode(taken = new Set()) {
  for (let i = 0; i < 100; i += 1) {
    let passcode = ''
    for (let n = 0; n < PASSCODE_LENGTH; n += 1) {
      passcode += PASSCODE_ALPHABET[randomInt(0, PASSCODE_ALPHABET.length)]
    }
    if (!taken.has(passcode)) return passcode
  }
  throw new Error('Could not generate a unique passcode')
}

// Generate a passcode and its keyed lookup fingerprint, skipping fingerprints
// already present for any vendor. The database's unique index is the final
// guard against two concurrent requests choosing the same passcode.
export function generatePasscodeRecord({
  takenLookups = new Set(),
  makePasscode = generatePasscode,
  secret,
} = {}) {
  for (let i = 0; i < 100; i += 1) {
    const passcode = makePasscode()
    const lookup = passcodeLookup(passcode, secret)
    if (!takenLookups.has(lookup)) return { passcode, lookup }
  }
  throw new Error('Could not generate a globally unique passcode')
}
