// app/api/members/auth/verify-otp/route.js
// Verify the OTP code the member received via email.
//   POST { memberId, email, token } → { ok, accessToken }
//
// On success, returns the Supabase Auth access token so the client can
// call the set-password endpoint in the next step.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const authSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  try {
    const { memberId, email, token } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()
    const addr = String(email || '').trim().toLowerCase()
    const code = String(token || '').trim()

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }
    if (!addr) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }
    if (!code || code.length < 4 || code.length > 8) {
      return NextResponse.json({ error: 'Please enter the OTP code sent to your email' }, { status: 400 })
    }

    // Rate limit: 5 OTP verify attempts per member per 15 minutes
    const verifyLimit = checkRateLimit('verify-otp', mid, 5, 15 * 60 * 1000)
    if (!verifyLimit.allowed) return rateLimitResponse(verifyLimit.retryAfterMs)

    // Verify the OTP with Supabase Auth
    const { data, error: verifyError } = await authSupabase.auth.verifyOtp({
      email: addr,
      token: code,
      type: 'email',
    })

    if (verifyError) {
      console.error('OTP verify error:', verifyError)
      return NextResponse.json(
        { error: verifyError.message || 'Invalid or expired OTP code' },
        { status: 401 }
      )
    }

    // data.session contains the access_token and refresh_token
    if (!data?.session?.access_token) {
      return NextResponse.json(
        { error: 'OTP verification failed. Please try again.' },
        { status: 401 }
      )
    }

    return NextResponse.json({
      ok: true,
      accessToken: data.session.access_token,
      user: {
        id: data.user?.id,
        email: data.user?.email,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
