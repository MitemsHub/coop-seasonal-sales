// app/api/members/auth/forgot-password/route.js
// Send a password-reset VERIFICATION CODE (6-digit OTP) to the member's
// registered email, using Supabase's RECOVERY flow so the message carries
// reset wording instead of the sign-in copy.
//   POST { memberId } → { ok }  (always, unless the request itself is invalid)
//   GET  → admin-only debug echo of the origin/env used to build the link
//
// WHY A CODE AND NOT A RESET LINK:
// The original flow sent a recovery LINK. Those messages never reach the
// member — Gmail silently discards account-recovery mail coming from the
// co-op's shared-hosting SMTP while delivering short verification codes fine
// (see docs/password-reset-deliverability-diagnosis.md).
//
// WHY resetPasswordForEmail AND NOT signInWithOtp:
// `signInWithOtp` always renders Supabase's *Magic Link* template, so a reset
// sent that way arrives wearing the sign-in copy ("complete your sign-in to
// the member portal"). The recovery flow renders the separate *Reset password*
// template, and GoTrue hands that template `{{ .Token }}` — the 6-digit code,
// not the long link token — so the member gets a genuinely reset-worded code
// email. It is verified as `type: 'recovery'` in verify-otp.
//
// The member verifies the code, which hands back a Supabase session token, and
// then /api/members/auth/set-password sets the new password on the SAME auth
// account. Nothing is deleted and the member never has to sign up again.
//
// To avoid leaking account existence, every no-send path returns the same
// generic { ok: true } as a successful send; the concrete reason is logged on
// the server only.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createDbClient } from '@/lib/supabaseServer'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Service-role client for the code send. The old anon-key call was being
// silently rejected on the hosted Supabase project (no email arrived and the
// SDK error was swallowed) — service-role sends skip the anonymous-key rate
// limits and are the path the diagnosis doc verified as reaching GoTrue.
const authServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// Resolves the URL-of-origin the member's browser sees, so the recovery
// redirect (must be on Supabase's allow-list) points to a reachable page. Order:
//   1. explicit NEXT_PUBLIC_SITE_URL (must be a full http(s) URL)
//   2. request Origin header (browser origin, works behind proxies)
//   3. request Host + x-forwarded-proto headers
function resolveSiteOrigin(request) {
  const direct = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')
  if (direct && /^https?:\/\//i.test(direct)) return direct
  if (request?.headers) {
    const origin = request.headers.get('origin')
    if (origin && /^https?:\/\//i.test(origin)) return origin
    const host = request.headers.get('host')
    if (host) {
      const proto =
        request.headers.get('x-forwarded-proto') ||
        (/^(localhost|127\.)/i.test(host) ? 'http' : 'https')
      return `${proto}://${host}`
    }
  }
  if (direct) return direct // configured but unprefixed — better than nothing
  return ''
}

// An UNCONFIRMED account can make Supabase fall back to a confirmation LINK
// instead of a 6-digit code — which is exactly the failure this flow must not
// have. A member reaching this endpoint already has a password, so their
// account is normally confirmed; if it isn't, confirm it in place first so the
// message is guaranteed to be a code.
// Never fatal: if the admin API hiccups we still attempt the send.
async function ensureAccountConfirmed(authUserId) {
  if (!authUserId) return
  try {
    const { data, error } = await authServiceRole.auth.admin.getUserById(authUserId)
    if (error) {
      console.warn('[forgot-password] auth user lookup failed (proceeding):', error.message)
      return
    }
    if (data?.user?.email_confirmed_at) return
    const { error: updErr } = await authServiceRole.auth.admin.updateUserById(authUserId, {
      email_confirm: true,
    })
    if (updErr) {
      console.warn('[forgot-password] could not confirm auth account (proceeding):', updErr.message)
    } else {
      console.log(`[forgot-password] confirmed previously unconfirmed account ${authUserId}`)
    }
  } catch (e) {
    console.warn('[forgot-password] confirm check crashed (proceeding):', e?.message || e)
  }
}

export async function POST(request) {
  try {
    const { memberId } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }

    // Rate limit: 3 reset requests per member per 10 minutes
    const resetLimit = checkRateLimit('forgot-pw', mid, 3, 10 * 60 * 1000)
    if (!resetLimit.allowed) return rateLimitResponse(resetLimit.retryAfterMs)

    const siteOrigin = resolveSiteOrigin(request)

    // Look up the member's email
    const db = createDbClient()
    const { data: member, error: mErr } = await db
      .from('members')
      .select('member_id, email, alternative_email, auth_user_id, portal_enabled')
      .eq('member_id', mid)
      .maybeSingle()

    if (mErr) {
      console.error('[forgot-password] members lookup failed:', mErr.message)
      return NextResponse.json({ error: mErr.message }, { status: 500 })
    }
    if (
      !member ||
      member.portal_enabled === false ||
      !member.auth_user_id ||
      !member.email
    ) {
      // Unknown member / not in the portal cohort / no auth account — never
      // reveal which; the concrete reason is on the server console.
      console.warn(
        `[forgot-password] ${mid}: no reset code sent (${member ? (member.portal_enabled === false ? 'not in cohort' : member.auth_user_id ? 'missing email' : 'no auth account') : 'unknown member'})`
      )
      return NextResponse.json({ ok: true })
    }

    // Supabase only honours this if it is a full origin; without one we omit it
    // rather than refuse to send the code (the member types it anyway).
    const redirectTo = siteOrigin ? `${siteOrigin}/reset-password` : undefined

    await ensureAccountConfirmed(member.auth_user_id)

    // Optional copy to the alternative inbox on file. Sent FIRST, primary
    // LAST, so the inbox the member is told about holds the live code — the
    // ordering rule the sign-up flow follows (see send-otp). Best effort only.
    const primary = String(member.email).trim().toLowerCase()
    const altRaw = String(member.alternative_email || '').trim().toLowerCase()
    const altAddr =
      altRaw && altRaw !== primary && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(altRaw)
        ? altRaw
        : null
    if (altAddr) {
      try {
        const alt = await authServiceRole.auth.resetPasswordForEmail(altAddr, { redirectTo })
        if (alt.error) {
          console.warn(`[forgot-password] ${mid}: alternate-inbox code failed:`, alt.error.message)
        }
      } catch (e) {
        console.warn(`[forgot-password] ${mid}: alternate-inbox send crashed:`, e?.message || e)
      }
    }

    // Send the reset code through the RECOVERY flow so it renders the
    // "Reset password" template (reset wording + {{ .Token }} = the 6-digit
    // code) rather than the Magic Link template the sign-in OTP uses.
    const { error: otpError } = await authServiceRole.auth.resetPasswordForEmail(primary, {
      redirectTo,
    })

    if (otpError) {
      console.error(
        `[forgot-password] reset code FAILED for ${mid} (${member.email}):`,
        JSON.stringify({
          code: otpError.code,
          status: otpError.status,
          message: otpError.message,
          redirectTo: redirectTo || null,
        })
      )
      // Still return success to avoid leaking info; the failure details are on
      // the server console. A retry (10 min apart, per rate limit) may succeed.
      return NextResponse.json({ ok: true })
    }

    console.log(
      `[forgot-password] reset code sent to ${mid} (${member.email})${siteOrigin ? ` → ${siteOrigin}/reset-password` : ' (no site origin — code only)'}`
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[forgot-password] unexpected error:', e.message || e)
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}

// Admin-only debug endpoint: echoes the origin the deployed environment will
// resolve for building any auth link (does not touch Supabase).
export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const origin = resolveSiteOrigin(request)
  return NextResponse.json({
    ok: true,
    mode: 'otp-code',
    env: {
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || null,
      service_role_set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    resolvedSiteOrigin: origin,
    redirectToExample: origin ? `${origin}/reset-password` : null,
  })
}
