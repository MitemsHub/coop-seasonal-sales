// GET /api/admin/exhibition/vendors/[id]/passcode
// The passcode currently in force for a vendor, decrypted from the encrypted
// copy. Sign-in verifies against the scrypt hash, which cannot be reversed, so
// this sealed copy is the only way to show an already-issued passcode.
//
//   { ok: true, available: true, passcode }
//   { ok: true, available: false, reason: 'not_stored' | 'not_configured' | 'migration' }
//
// available:false is an ordinary answer (passcodes issued before the copy
// existed, or a rotated APP_SECRET), not an error: the UI then offers a reset.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { decryptPasscode, isMissingEncryptedColumn } from '@/lib/passcodeVault'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid vendor' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: vendor, error } = await supabase
      .from('exhibition_vendors')
      .select('id, code, passcode_encrypted')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      if (isMissingEncryptedColumn(error)) {
        return NextResponse.json({ ok: true, available: false, reason: 'migration' })
      }
      if (String(error.code || '') === '42P01') {
        return NextResponse.json(
          { ok: false, error: 'Coop Exhibition is not set up yet. Run migrations/add-coop-exhibition-module.sql in Supabase.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    if (!vendor) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 404 })

    if (!vendor.passcode_encrypted) {
      return NextResponse.json({ ok: true, available: false, reason: 'not_stored' })
    }
    const passcode = decryptPasscode(vendor.passcode_encrypted)
    if (!passcode) {
      return NextResponse.json({ ok: true, available: false, reason: 'not_configured' })
    }

    // Never cached: the response is a live credential.
    return NextResponse.json(
      { ok: true, available: true, passcode },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load passcode' }, { status: 500 })
  }
}
