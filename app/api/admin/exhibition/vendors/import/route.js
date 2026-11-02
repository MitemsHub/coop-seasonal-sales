// app/api/admin/exhibition/vendors/import/route.js
// Admin batch upload of vendor accounts. The admin supplies only the stand
// name, phone and address; the system makes a readable code (V-ABJ-03) and a
// memorable passcode (mango-4821). Passcodes are hashed before storage, so the
// plaintext exists only in this response — the admin must hand it over.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'
import { hashPasscode } from '@/lib/passcodeHash'
import { generateVendorCode, generatePasscode } from '@/lib/vendorCredentials'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Passcodes are scrypt-hashed one at a time, so keep batches modest.
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

    const { data: existing, error: codeError } = await supabase.from('exhibition_vendors').select('code')
    if (codeError) return NextResponse.json({ ok: false, error: codeError.message }, { status: 500 })
    const takenCodes = new Set((existing || []).map((v) => String(v.code || '').toUpperCase()))
    const takenPasscodes = new Set()

    const failed = []
    const created = []
    for (let i = 0; i < rawRows.length; i += 1) {
      const name = sanitizeString(rawRows[i]?.name || '', { maxLength: 255, encodeHtml: false })
      if (!name) {
        failed.push({ row: i + 1, error: 'Vendor name is missing' })
        continue
      }

      let code
      try {
        code = generateVendorCode({ branchCode: branch.code, taken: takenCodes })
      } catch (e) {
        failed.push({ row: i + 1, error: e.message })
        continue
      }
      takenCodes.add(code)
      const passcode = generatePasscode(takenPasscodes)
      takenPasscodes.add(passcode)

      const { data, error } = await supabase
        .from('exhibition_vendors')
        .insert({
          cycle_id: cycleId,
          branch_id: branchId,
          name,
          code,
          passcode: await hashPasscode(passcode),
          phone: sanitizeString(rawRows[i]?.phone || '', { maxLength: 30, encodeHtml: false }),
          address: sanitizeString(rawRows[i]?.address || '', { maxLength: 300, encodeHtml: false }),
          status: 'active',
        })
        .select('id, name, code, phone')
        .single()

      if (error) failed.push({ row: i + 1, error: error.message })
      else created.push({ ...data, passcode, branch: branch.name || branch.code })
    }

    return NextResponse.json({ ok: true, created, failed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to import vendors' }, { status: 500 })
  }
}
