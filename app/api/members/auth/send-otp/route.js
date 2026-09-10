// app/api/members/auth/send-otp/route.js
// Send a one-time password (OTP) to the member's email via Supabase Auth.
//   POST { memberId } → { ok }
//
// The email is looked up server-side from the members table — the client
// never sends it, avoiding masked-email mismatches. This is the first step
// of the member signup flow.
//
// IMPORTANT: When Supabase Auth has "Enable email confirmations" ON (default),
// signInWithOtp for NEW users may send a confirmation LINK instead of a 6-digit
// OTP code. This endpoint detects that case and handles it gracefully.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createDbClient } from '@/lib/supabaseServer'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Auth client using the anon key — user-level auth operations
const authSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Service-role client for admin operations (checking/deleting auto-created users)
const authAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function getClientIP(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || request.headers.get('x-vercel-forwarded-for') || 'unknown'
}

/**
 * Attempt to send OTP with retry logic for transient failures.
 * Retries up to 2 times with exponential backoff on transient errors.
 */
async function sendOtpWithRetry(email, options, maxRetries = 2) {
  let lastError = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }

    const result = await authSupabase.auth.signInWithOtp({ email, options })
    lastError = result.error

    if (!result.error) {
      return { data: result.data, error: null }
    }

    // Don't retry on non-transient errors
    const msg = (result.error.message || '').toLowerCase()
    const isTransient =
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')

    if (!isTransient) {
      return result
    }

    console.warn(`[send-otp] Transient error on attempt ${attempt + 1}:`, result.error.message)
  }

  // All retries exhausted
  return { data: null, error: lastError }
}

export async function POST(request) {
  try {
    const ip = getClientIP(request)
    const { memberId } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }

    // Rate limit: 10 OTP requests per IP per 5 minutes (prevents email bombing)
    const ipLimit = checkRateLimit('send-otp-ip', ip, 10, 5 * 60 * 1000)
    if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterMs)

    // Verify the member exists and look up their email on file.
    const db = createDbClient()
    const { data: member, error: mErr } = await db
      .from('members')
      .select('member_id, email, auth_user_id')
      .eq('member_id', mid)
      .maybeSingle()

    if (mErr) {
      console.error('[send-otp] DB lookup error:', mErr.message)
      return NextResponse.json({ error: mErr.message }, { status: 500 })
    }
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // If the member already has an auth account, they should use login instead
    if (member.auth_user_id) {
      return NextResponse.json(
        { error: 'This member already has an account. Please log in instead.' },
        { status: 409 }
      )
    }

    if (!member.email) {
      return NextResponse.json(
        { error: 'No email address on file for this member. Please ask an admin to add your email first.' },
        { status: 400 }
      )
    }

    const addr = member.email.toLowerCase()

    // Rate limit: 3 OTP requests per email per 5 minutes
    const otpLimit = checkRateLimit('send-otp', addr, 3, 5 * 60 * 1000)
    if (!otpLimit.allowed) return rateLimitResponse(otpLimit.retryAfterMs)

    // Send OTP via Supabase Auth.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin
    const { data: otpData, error: otpError } = await sendOtpWithRetry(
      addr,
      {
        data: { member_id: mid },
        emailRedirectTo: `${siteUrl}/auth/callback`,
      }
    )

    if (otpError) {
      const errorMeta = {
        code: otpError.code,
        message: otpError.message,
        status: otpError.status,
        member_id: mid,
        email_domain: addr.split('@')[1],
        siteUrl,
        timestamp: new Date().toISOString(),
      }

      // ── Special handling: Supabase may have auto-created a Supabase Auth
      // user and sent a CONFIRMATION LINK instead of an OTP code.
      // This happens when Supabase Auth has "Enable email confirmations" ON.
      // In that case, signInWithOtp succeeds (no error) but the user receives
      // a link, not a code. We detect this by checking if a user was created.
      // However, since there's no error here, we handle it BELOW after the
      // success path.

      console.error('[send-otp] Supabase signInWithOtp error:', errorMeta)

      // Return user-friendly error messages
      let userMessage = 'Failed to send OTP. Please try again.'
      const msg = (otpError.message || '').toLowerCase()

      if (msg.includes('email rate limit') || otpError.code === 'email_rate_limit') {
        userMessage = 'Too many requests. Please wait a few minutes before trying again.'
      } else if (msg.includes('smtp') || msg.includes('email provider') || msg.includes('connection refused') || msg.includes('email')) {
        // Include the actual Supabase error for better diagnostics
        userMessage = `Email delivery failed: ${otpError.message || 'SMTP error'}. Please try again later or contact support.`
      } else if (msg.includes('invalid email') || otpError.code === 'invalid_email') {
        userMessage = 'The email address on file appears to be invalid. Please contact an admin to update it.'
      } else if (otpError.status === 429 || msg.includes('rate limit')) {
        userMessage = 'Too many requests. Please wait a few minutes before trying again.'
      } else if (msg.includes('signup disabled') || msg.includes('sign up disabled')) {
        userMessage = 'Account registration is temporarily disabled. Please contact support.'
      } else if (msg.includes('email domain') || msg.includes('not allowed')) {
        userMessage = 'Your email domain is not supported. Please contact support.'
      } else if (msg.includes('timeout') || msg.includes('network')) {
        userMessage = 'Network timeout. Please check your connection and try again.'
      } else {
        // Show the actual error message for unknown errors
        userMessage = `Failed to send OTP: ${otpError.message || 'Unknown error'}. Please try again or contact support.`
      }

      return NextResponse.json({ error: userMessage }, { status: 500 })
    }

    // ── OTP sent successfully (no error from signInWithOtp).
    // Now we need to check if Supabase Auth created a new user and sent a
    // CONFIRMATION LINK instead of an OTP code. This happens when:
    //   - Supabase Auth has "Enable email confirmations" ON
    //   - The email doesn't exist in auth.users yet
    //
    // In this case, signInWithOtp returns success but the user receives an
    // email with a LINK (not a 6-digit code). Our verify-otp endpoint expects
    // a 6-digit code, so it would fail.
    //
    // To detect and handle this: we check if a new auth user was auto-created.
    // If so, we need to clean it up and use the admin API to send a proper OTP.

    // Check if an auth user was auto-created for this email.
    // We page through listUsers (max 1000 per call) until we find the email
    // or exhaust all users, so we never miss it due to pagination.
    let autoCreatedUser = null
    let page = 1
    const perPage = 1000
    while (!autoCreatedUser) {
      const { data: authUsers, error: listErr } = await authAdmin.auth.admin.listUsers({
        page,
        perPage,
      })
      if (listErr || !authUsers?.users?.length) break
      autoCreatedUser = authUsers.users.find(
        (u) => u.email?.toLowerCase() === addr && !u.email_confirmed_at
      )
      if (authUsers.users.length < perPage) break // last page
      page++
      if (page > 10) break // safety cap (~10k users)
    }

    if (autoCreatedUser) {
      // A user was auto-created but email is not confirmed.
      // This means Supabase sent a confirmation LINK, not an OTP code.
      // We need to clean up this user and use a different approach.

      console.warn(`[send-otp] Auto-created auth user detected for ${addr}.` +
        ' Supabase Auth may have sent a confirmation LINK instead of an OTP code.' +
        ' Cleaning up and retrying with admin approach.')

      // Delete the auto-created user so we can start fresh
      await authAdmin.auth.admin.deleteUser(autoCreatedUser.id)

      // Wait a moment for the deletion to propagate
      await new Promise((r) => setTimeout(r, 500))

      // Now retry — this time Supabase should send a proper OTP
      // because the user no longer exists and we're using signInWithOtp
      const retryResult = await sendOtpWithRetry(
        addr,
        {
          data: { member_id: mid },
          emailRedirectTo: `${siteUrl}/auth/callback`,
        }
      )

      if (retryResult.error) {
        console.error('[send-otp] Retry after cleanup failed:', retryResult.error)
        return NextResponse.json(
          { error: 'Failed to send verification code. Please try again or contact support.' },
          { status: 500 }
        )
      }

      // Retry succeeded — the OTP code should now be sent
      return NextResponse.json({
        ok: true,
        note: 'Verification code sent. If you receive a link instead of a code, please contact support.',
      })
    }

    // OTP sent successfully — no auto-created user detected.
    // This is the happy path: Supabase sent a 6-digit OTP code.
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[send-otp] Unexpected error:', e.message || e)
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
