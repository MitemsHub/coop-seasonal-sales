// lib/vendorPasscodeLookup.js
// Helpers for loading and extending the vendor passcode uniqueness set.
import { passcodeLookup } from './passcodeHash'

export function addPasscodesToLookupSet(lookups, passcodes, secret) {
  for (const passcode of passcodes || []) {
    const value = String(passcode || '')
    if (value) lookups.add(passcodeLookup(value, secret))
  }
  return lookups
}

export async function loadPasscodeLookups(supabase, { excludeVendorId } = {}) {
  let query = supabase.from('exhibition_vendors').select('passcode_lookup')
  if (excludeVendorId) query = query.neq('id', excludeVendorId)

  const { data, error } = await query
  if (error) {
    const message = String(error.message || '')
    if (String(error.code || '') === '42703' || message.includes('passcode_lookup')) {
      throw new Error(
        'Passcode uniqueness is not set up. Run migrations/add-exhibition-vendor-passcode-lookup.sql in Supabase.'
      )
    }
    throw new Error(message || 'Could not load existing passcodes')
  }

  return new Set((data || []).map((row) => row.passcode_lookup).filter(Boolean))
}
