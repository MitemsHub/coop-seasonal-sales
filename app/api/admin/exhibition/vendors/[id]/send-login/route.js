// POST /api/admin/exhibition/vendors/[id]/send-login
// Email a vendor their sign-in details.
//
// Body: { passcode? }
//   - With passcode, that passcode is saved and sent.
//   - Without one, a fresh easy-to-read passcode is generated and sent, so an
//     admin can recover a vendor who has lost their details.
//
// The plaintext passcode is returned to the signed-in admin as a fallback if
// mail delivery fails. It is never stored in plaintext.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'
import { hashPasscode } from '@/lib/passcodeHash'
import { generatePasscode } from '@/lib/vendorCredentials'
import { missingMailConfig, sendVendorLoginEmail } from '@/lib/vendorMailer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid vendor' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const requestedPasscode = sanitizeString(body?.passcode || '', { maxLength: 50, encodeHtml: false })
    if (requestedPasscode && requestedPasscode.length < 4) {
      return NextResponse.json({ ok: false, error: 'Passcode must be at least 4 characters' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: vendor, error } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, name, code, email, status, cycles:cycle_id(name)')
      .eq('id', id)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!vendor) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 404 })
    if (!vendor.email) {
      return NextResponse.json({ ok: false, error: 'Add an email address for this vendor first.' }, { status: 400 })
    }

    const missing = missingMailConfig()
    if (missing.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `Email is not configured. Add ${missing.join(', ')} to the server environment, then try again.`,
        },
        { status: 503 }
      )
    }

    const passcode = requestedPasscode || generatePasscode()
    const { error: saveError } = await supabase
      .from('exhibition_vendors')
      .update({ passcode: await hashPasscode(passcode), updated_at: new Date().toISOString() })
      .eq('id', id)
    if (saveError) return NextResponse.json({ ok: false, error: saveError.message }, { status: 500 })

    const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim() || new URL(request.url).origin
    const loginUrl = `${siteUrl.replace(/\/+$/, '')}/vendor/login`

    try {
      await sendVendorLoginEmail({
        to: vendor.email,
        vendorName: vendor.name,
        code: vendor.code,
        passcode,
        loginUrl,
        cycleName: vendor.cycles?.name || '',
      })
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: `Could not send the email: ${e.message || 'mail delivery failed'}. Share this passcode instead: ${passcode}`,
          passcode,
        },
        { status: 502 }
      )
    }

    const sentAt = new Date().toISOString()
    await supabase.from('exhibition_vendors').update({ login_sent_at: sentAt }).eq('id', id)

    return NextResponse.json({
      ok: true,
      sent_to: vendor.email,
      sent_at: sentAt,
      code: vendor.code,
      passcode,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to send login details' }, { status: 500 })
  }
}
