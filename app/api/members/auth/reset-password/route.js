// app/api/members/auth/reset-password/route.js
// Complete a password reset using the recovery token from the email link.
//   POST { accessToken, password } → { ok }
//
// When the member clicks the reset link in their email, Supabase redirects
// them to /reset-password with the token in the URL hash. The client sends
// that token here along with the new password.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const authSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  try {
    const { accessToken, password } = await request.json().catch(() => ({}))
    const token = String(accessToken || '').trim()
    const pw = String(password || '')

    if (!token) {
      return NextResponse.json({ error: 'Reset token is required' }, { status: 400 })
    }
    if (!pw || pw.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    // Create a client authenticated with the recovery token
    const userClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    )

    const { error } = await userClient.auth.updateUser({ password: pw })

    if (error) {
      console.error('Reset password error:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to reset password' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
