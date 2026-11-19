// POST /api/admin/exhibition/vendors/[id]/send-login
// Email a vendor their sign-in details.
//
// Body: { mode?: 'reminder' | 'reset', passcode? }
//   - mode 'reminder' (default without a passcode): re-sends the sign-in steps
//     without touching the stored passcode, so the details already in the
//     vendor's inbox keep working.
//   - mode 'reset', or any request carrying a passcode: rotates the passcode
//     and emails the new one. Rotation is always an explicit admin action.
//
// Rotation used to be the default on every send, which silently invalidated
// passcodes the vendors already had and made failed sign-ins ambiguous.
//
// The plaintext passcode is returned to the signed-in admin as a fallback if
// mail delivery fails. It is never stored in plaintext.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'
import { hashPasscode, passcodeLookup } from '@/lib/passcodeHash'
import { generatePasscodeRecord } from '@/lib/vendorCredentials'
import { loadPasscodeLookups } from '@/lib/vendorPasscodeLookup'
import { missingMailConfig, sendVendorLoginEmail } from '@/lib/vendorMailer'
import { checkRateLimitShared, rateLimitResponse } from '@/lib/rateLimitShared'
import { VENDOR_EMAIL_HOUR_LIMIT, VENDOR_EMAIL_MINUTE_LIMIT } from '@/lib/vendorEmailLimits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  // Backstop against a scripted burst. The admin UI paces bulk mail well below
  // these limits, and the bucket is shared so multiple admins cannot combine
  // into a burst against the same SMTP account.
  const minuteLimit = await checkRateLimitShared(
    'exhibition-vendor-email-minute',
    'smtp',
    VENDOR_EMAIL_MINUTE_LIMIT,
    60_000
  )
  if (!minuteLimit.allowed) return rateLimitResponse(minuteLimit.retryAfterMs)
  const hourLimit = await checkRateLimitShared(
    'exhibition-vendor-email-hour',
    'smtp',
    VENDOR_EMAIL_HOUR_LIMIT,
    60 * 60_000
  )
  if (!hourLimit.allowed) return rateLimitResponse(hourLimit.retryAfterMs)

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
    const mode = requestedPasscode || String(body?.mode || '') === 'reset' ? 'reset' : 'reminder'

    const supabase = createClient()
    const { data: vendor, error } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, name, code, email, status, login_sent_at, cycles:cycle_id(name)')
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

    const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim() || new URL(request.url).origin
    const loginUrl = `${siteUrl.replace(/\/+$/, '')}/vendor/login`

    // Reminder: repeat the code and the sign-in steps, never the passcode, and
    // leave login_sent_at alone so it still records when credentials went out.
    if (mode === 'reminder') {
      if (!vendor.login_sent_at) {
        return NextResponse.json(
          {
            ok: false,
            error: 'No login details have been sent to this vendor yet. Send their login details instead of a reminder.',
          },
          { status: 400 }
        )
      }
      try {
        await sendVendorLoginEmail({
          to: vendor.email,
          vendorName: vendor.name,
          code: vendor.code,
          loginUrl,
          cycleName: vendor.cycles?.name || '',
          reminder: true,
        })
      } catch (e) {
        return NextResponse.json(
          { ok: false, error: `Could not send the email: ${e.message || 'mail delivery failed'}` },
          { status: 502 }
        )
      }
      return NextResponse.json({
        ok: true,
        reminder: true,
        sent_to: vendor.email,
        sent_at: new Date().toISOString(),
        code: vendor.code,
      })
    }

    const takenLookups = await loadPasscodeLookups(supabase, { excludeVendorId: id })
    let passcode
    let lookup
    if (requestedPasscode) {
      passcode = requestedPasscode
      lookup = passcodeLookup(passcode)
      if (takenLookups.has(lookup)) {
        return NextResponse.json({ ok: false, error: 'That passcode is already assigned to another vendor.' }, { status: 409 })
      }
    } else {
      ;({ passcode, lookup } = generatePasscodeRecord({ takenLookups }))
    }

    const { error: saveError } = await supabase
      .from('exhibition_vendors')
      .update({
        passcode: await hashPasscode(passcode),
        passcode_lookup: lookup,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (saveError) {
      if (String(saveError.code || '') === '23505') {
        return NextResponse.json({ ok: false, error: 'That passcode is already assigned to another vendor.' }, { status: 409 })
      }
      return NextResponse.json({ ok: false, error: saveError.message }, { status: 500 })
    }

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
