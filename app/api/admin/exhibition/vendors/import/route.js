// app/api/admin/exhibition/vendors/import/route.js
// Admin batch upload of vendor accounts. The admin supplies the stand name,
// optional email, phone and address; the system makes a readable code
// (V0001) and a professional passcode (K7Q2M9). Passcodes are hashed before
// storage, so the plaintext exists only in this response — the admin must hand
// it over or email it from the import result.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'
import { hashPasscode } from '@/lib/passcodeHash'
import { encryptPasscode, withPasscodeFallback } from '@/lib/passcodeVault'
import { generateVendorCode, generatePasscodeRecord } from '@/lib/vendorCredentials'
import { addPasscodesToLookupSet } from '@/lib/vendorPasscodeLookup'
import { isValidEmail, normalizeEmail } from '@/lib/emailAddress'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Passcodes are scrypt-hashed one at a time, so keep each request modest.
// The import modal sends larger uploads (up to 500) in 50-row chunks.
const MAX_ROWS = 50

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const cycleId = Math.trunc(Number(body?.cycle_id || 0))
    const branchId = Math.trunc(Number(body?.branch_id || 0))
    if (!Number.isFinite(cycleId) || cycleId <= 0) return NextResponse.json({ ok: false, error: 'Cycle is required' }, { status: 400 })
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Branch is required' }, { status: 400 })

    const rawRows = Array.isArray(body?.rows) ? body.rows : []
    if (!rawRows.length) return NextResponse.json({ ok: false, error: 'No rows to import' }, { status: 400 })
    if (rawRows.length > MAX_ROWS) {
      return NextResponse.json({ ok: false, error: `Import at most ${MAX_ROWS} vendors at a time` }, { status: 400 })
    }

    const supabase = createClient()
    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('id, code, name')
      .eq('id', branchId)
      .maybeSingle()
    if (branchError) return NextResponse.json({ ok: false, error: branchError.message }, { status: 500 })
    if (!branch) return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })

    const { data: existing, error: codeError } = await supabase
      .from('exhibition_vendors')
      .select('code, passcode_lookup')
    if (codeError) return NextResponse.json({ ok: false, error: codeError.message }, { status: 500 })
    const takenCodes = new Set((existing || []).map((v) => String(v.code || '').toUpperCase()))
    const takenLookups = new Set((existing || []).map((v) => v.passcode_lookup).filter(Boolean))
    // The modal sends back passcodes from earlier chunks, so a 500-vendor
    // upload cannot generate the same passcode twice across chunks.
    const reservedPasscodes = Array.isArray(body?.reserved_passcodes)
      ? body.reserved_passcodes.slice(0, 1000)
      : []
    addPasscodesToLookupSet(takenLookups, reservedPasscodes)

    const failed = []
    const created = []
    for (let i = 0; i < rawRows.length; i += 1) {
      const name = sanitizeString(rawRows[i]?.name || '', { maxLength: 255, encodeHtml: false })
      if (!name) {
        failed.push({ row: i + 1, error: 'Vendor name is missing' })
        continue
      }
      const email = normalizeEmail(rawRows[i]?.email)
      if (email && !isValidEmail(email)) {
        failed.push({ row: i + 1, error: 'Email address is not valid' })
        continue
      }

      let code
      try {
        code = generateVendorCode({ taken: takenCodes })
      } catch (e) {
        failed.push({ row: i + 1, error: e.message })
        continue
      }
      takenCodes.add(code)
      const { passcode, lookup } = generatePasscodeRecord({ takenLookups })
      takenLookups.add(lookup)

      const record = {
        cycle_id: cycleId,
        branch_id: branchId,
        name,
        code,
        passcode: await hashPasscode(passcode),
        passcode_lookup: lookup,
        // Sealed copy so the admin can re-read this passcode later; import used
        // to be a one-shot reveal.
        passcode_encrypted: encryptPasscode(passcode),
        email,
        phone: sanitizeString(rawRows[i]?.phone || '', { maxLength: 30, encodeHtml: false }),
        address: sanitizeString(rawRows[i]?.address || '', { maxLength: 300, encodeHtml: false }),
        status: 'active',
      }
      const insertVendor = (row) =>
        supabase.from('exhibition_vendors').insert(row).select('id, name, code, email, phone').single()

      let { data, error } = await withPasscodeFallback(record, insertVendor)

      if (error) failed.push({ row: i + 1, error: error.message })
      else created.push({ ...data, passcode, branch: branch.name || branch.code })
    }

    return NextResponse.json({ ok: true, created, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to import vendors' }, { status: 500 })
  }
}
