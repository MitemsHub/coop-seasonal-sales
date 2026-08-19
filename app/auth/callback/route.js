// app/auth/callback/route.js
// Handles the Supabase Auth email confirmation redirect.
// When a user clicks the "Confirm email address" link in the Supabase email,
// they are redirected here with token_hash and type query parameters.
// We verify the token with Supabase and redirect to a confirmation page.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const authSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') || 'signup'
  const redirectTo = searchParams.get('redirect_to') || '/portal#member'

  if (!tokenHash) {
    // No token — redirect to portal with an error
    return NextResponse.redirect(`${origin}/auth/confirm?error=missing_token`)
  }

  try {
    // Verify the token hash using Supabase's verifyOtp API.
    // For email confirmation links, the type is always 'email'.
    const { error } = await authSupabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'email',
    })

    if (error) {
      console.error('Email confirmation verify error:', error)
      return NextResponse.redirect(`${origin}/auth/confirm?error=expired`)
    }

    // Success — redirect to the portal sign-in section
    return NextResponse.redirect(`${origin}/auth/confirm?success=true`)
  } catch (e) {
    console.error('Email confirmation error:', e)
    return NextResponse.redirect(`${origin}/auth/confirm?error=server_error`)
  }
}
