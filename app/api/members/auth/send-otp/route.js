// app/api/members/auth/send-otp/route.js
// Send a one-time password (OTP) to the given email via Supabase Auth.
//   POST { memberId, email } → { ok }
//
// This is the first step of the member signup flow. The OTP is a 6-digit
// code that Supabase delivers via its built-in email provider.
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

export async function POST(request) {
  try {
    const { memberId, email } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()
    const addr = String(email || '').trim().toLowerCase()

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }
    if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
    }

    // Rate limit: 3 OTP requests per email per 5 minutes
    const otpLimit = checkRateLimit('send-otp', addr, 3, 5 * 60 * 1000)
    if (!otpLimit.allowed) return rateLimitResponse(otpLimit.retryAfterMs)

    // Verify the member exists and check their email on file
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

    // SECURITY: The email must match the one on file in the members table.
    // This prevents someone who knows another member's ID from hijacking
    // their account with their own email.
    if (!member.email) {
      return NextResponse.json(
        { error: 'No email address on file for this member. Please ask an admin to add your email first.' },
        { status: 400 }
      )
    }
    if (member.email.toLowerCase() !== addr) {
      return NextResponse.json(
        { error: 'The email you entered does not match the email on file. Please use the email registered with your account.' },
        { status: 403 }
      )
    }

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
