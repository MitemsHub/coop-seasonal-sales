// lib/vendorCredentials.js
// Admin batch-uploads vendors without thinking up logins: the system makes a
// short code (branch + number, e.g. V-ABJ-03) and a passcode a person can read
// out loud (e.g. mango-4821). Both are unique; passcodes are hashed before
// storage, so the plaintext only exists in the import result the admin sees.
import { randomInt } from 'crypto'

const WORDS = [
  'mango', 'kola', 'amber', 'cocoa', 'palm', 'ginger', 'pepper', 'onion',
  'tomato', 'pawpaw', 'guava', 'banana', 'orange', 'melon', 'cashew', 'sesame',
  'honey', 'millet', 'maize', 'cassava', 'yam', 'coconut', 'avocado', 'lemon',
  'sugar', 'salt', 'river', 'field', 'harvest', 'market', 'stand', 'basket',
  'kiosk', 'north', 'south', 'east', 'west', 'copper', 'ivory', 'savannah',
]

function branchToken(code) {
  const clean = String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  return clean.slice(0, 4) || 'GEN'
}

// V-<BRANCH>-<NN> — readable, identifies the stand's branch, and unique
// because we skip any code already in use.
export function generateVendorCode({ branchCode, taken = new Set() }) {
  const branch = branchToken(branchCode)
  for (let n = 1; n <= 999; n += 1) {
    const code = `V-${branch}-${String(n).padStart(2, '0')}`
    if (!taken.has(code)) return code
  }
  throw new Error('No vendor codes left for this branch')
}

// <word>-<4 digits> — easy to remember and say, still random enough that
// nobody guesses a neighbour's stand login.
export function generatePasscode(taken = new Set()) {
  for (let i = 0; i < 100; i += 1) {
    const word = WORDS[randomInt(0, WORDS.length)]
    const passcode = `${word}-${randomInt(1000, 10000)}`
    if (!taken.has(passcode)) return passcode
  }
  throw new Error('Could not generate a unique passcode')
}
