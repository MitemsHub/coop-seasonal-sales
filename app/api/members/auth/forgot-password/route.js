// app/api/members/auth/forgot-password/route.js
// Send a password-reset VERIFICATION CODE (6-digit OTP) to the member's
// registered email, using Supabase's RECOVERY flow so the message carries
// reset wording instead of the sign-in copy.
//   POST { memberId } → { ok }, or { error } when Supabase rejected the send
//                (rate limit / SMTP / redirect). Unknown members still get
//                { ok } so account existence is not revealed.
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
// To avoid leaking account existence, the "this member cannot receive a
// code" paths (unknown ID, outside the portal cohort, no auth account) still
// return the same generic { ok: true } as a successful send, with the
// concrete reason on the server console. A send that SUPABASE REJECTED is
// different: that is reported back as an error, because answering "code sent"
// for a mail that was never handed to SMTP is what hid this failure — the
// member waited for an email the system had already failed to produce.
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

    const primary = String(member.email).trim().toLowerCase()
    const altRaw = String(member.alternative_email || '').trim().toLowerCase()
    const altAddr =
      altRaw && altRaw !== primary && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(altRaw)
        ? altRaw
        : null

    // Send the reset code through the RECOVERY flow so it renders the
    // "Reset password" template (reset wording + {{ .Token }} = the 6-digit
    // code) rather than the Magic Link template the sign-in OTP uses.
    //
    // PRIMARY INBOX FIRST. Every Supabase Auth email draws on one project-wide
    // hourly send budget (30/hour on custom SMTP out of the box), so a copy to
    // the alternate address queued ahead of the primary could spend the quota
    // the member's own inbox needs — and the primary is the address the login
    // screen showed them. The alternate copy is best effort and only attempted
    // once the primary send has succeeded.
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
      // Do NOT claim success here. The member's screen already says "code
      // sent" on { ok: true }, so reporting success on a rejected send is
      // what made this failure invisible — the code never left Supabase and
      // nobody had any reason to retry. The wording stays generic so the
      // response still distinguishes nothing about the account itself.
      const rateLimited =
        otpError.status === 429 ||
        /rate.?limit|too many|over_email_send_rate_limit|over_request_rate_limit/i.test(
          `${otpError.code || ''} ${otpError.message || ''}`
        )
      return NextResponse.json(
        {
          error: rateLimited
            ? 'Too many attempts. Please wait a minute before requesting another code.'
            : 'We could not send the reset code right now. Please try again in a few minutes.',
        },
        { status: rateLimited ? 429 : 502 }
      )
    }

    // Optional copy to the alternate inbox on file — best effort only, and
    // never allowed to mask the primary send's outcome.
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
