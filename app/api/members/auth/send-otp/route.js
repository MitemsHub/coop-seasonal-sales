// app/api/members/auth/send-otp/route.js
// Send a one-time password (OTP) to the member's email via Supabase Auth.
//   POST { memberId } → { ok }
//
// The email is looked up server-side from the members table — the client
// never sends it, avoiding masked-email mismatches. This is the first step
// of the member signup flow.
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

function getClientIP(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || request.headers.get('x-vercel-forwarded-for') || 'unknown'
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
    // The email is derived server-side — the client never sends it, so there
    // is no risk of a masked/mismatched value reaching this endpoint.
    const db = createDbClient()
    const { data: member, error: mErr } = await db
      .from('members')
      .select('member_id, email, auth_user_id')
      .eq('member_id', mid)
      .maybeSingle()

    if (mErr) {
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

    // Send OTP via Supabase Auth
    const { error: otpError } = await authSupabase.auth.signInWithOtp({
      email: addr,
      options: {
        // Store the member ID in the user metadata so we can link it after verification
        data: { member_id: mid },
      },
    })

    if (otpError) {
      console.error('OTP send error:', otpError)
      return NextResponse.json(
        { error: otpError.message || 'Failed to send OTP. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
