// app/api/members/auth/login/route.js
// Member login with email + password via Supabase Auth.
//   POST { memberId, password } → { ok, member }
//
// The member enters their Staff ID; the server looks up the email on file,
// authenticates via Supabase Auth, then issues a signed session cookie.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createDbClient } from '@/lib/supabaseServer'
import { sign } from '@/lib/signingEdge'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { verifyPassword } from '@/lib/localPassword'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_TTL = 60 * 60 * 8

// Auth client using the anon key
const authSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  try {
    const { memberId, password } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()
    const pw = String(password || '')

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }
    if (!pw) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    // Rate limit: 5 login attempts per member per 15 minutes
    const loginLimit = checkRateLimit('login', mid, 5, 15 * 60 * 1000)
    if (!loginLimit.allowed) return rateLimitResponse(loginLimit.retryAfterMs)

    // Look up the member to get their email and auth_user_id
    const db = createDbClient()
    const { data: member, error: mErr } = await db
      .from('members')
      .select('member_id, email, auth_user_id, full_name, branch_id, portal_enabled, password_hash, branches:branch_id(code, name)')
      .eq('member_id', mid)
      .maybeSingle()

    if (mErr) {
      console.error('Member login: member lookup failed:', mErr)
      return NextResponse.json(
        { error: 'Something went wrong while checking the account. Please try again.' },
        { status: 500 }
      )
    }
    if (!member) {
      return NextResponse.json(
        { error: 'No member account found for that Staff ID. Please check it and try again.' },
        { status: 404 }
      )
    }

    // Members excluded from the latest official member import can't sign in
    if (member.portal_enabled === false) {
      return NextResponse.json(
        { error: 'No member account found for that Staff ID. Please check it and try again.' },
        { status: 404 }
      )
    }
    // ── Password-only sign-in for pensioners ("P"-prefixed IDs) ──────
    // Most pensioners have no email and no Supabase Auth account, so the
    // generic "not set up yet" guard below must NOT run for them — the
    // locally-set password (if any) is their account. See lib/localPassword
    // and /api/admin/members/set-password.
    const isPensionerId = mid.charAt(0) === 'P'
    if (isPensionerId && member.password_hash) {
      if (!verifyPassword(pw, member.password_hash)) {
        return NextResponse.json(
          { error: 'Incorrect password. Please check it and try again, or ask the admin to reset your password.' },
          { status: 401 }
        )
      }

      // Issue the same signed member session cookie as the email flow
      const localClaims = {
        role: 'member',
        member_id: mid,
        branch_id: member.branch_id ? Number(member.branch_id) : null,
        branch_code: member.branches?.code || '',
        name: member.full_name || '',
        auth_user_id: null,
      }
      const localToken = await sign(localClaims, TOKEN_TTL)

      const localRes = NextResponse.json({ success: true, member: localClaims })
      localRes.cookies.set('member_token', localToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: TOKEN_TTL,
      })
      return localRes
    }

    // A pensioner WITHOUT a local password and without an email/auth set-up
    // can never complete the email-OTP flow — point them to the self-service
    // first-time setup on the sign-in card (enter Staff ID → Continue).
    if (isPensionerId && (!member.email || !member.auth_user_id)) {
      return NextResponse.json(
        { error: 'Your portal password has not been set up yet. Please sign in with your Staff ID on the portal to create your password, or ask the co-op admin for help.' },
        { status: 403 }
      )
    }

    if (!member.auth_user_id || !member.email) {
      return NextResponse.json(
        { error: 'This account has not been set up yet. Please sign up first.' },
        { status: 403 }
      )
    }

    // Authenticate with Supabase Auth
    const { data: authData, error: authError } = await authSupabase.auth.signInWithPassword({
      email: member.email,
      password: pw,
    })

    if (authError) {
      console.error('Login error:', authError)
      // Never surface Supabase's raw auth messages (e.g. "Invalid login
      // credentials") — map them to friendly, member-facing copy.
      const authMsg = String(authError.message || '').toLowerCase()
      const friendly = authMsg.includes('not confirmed')
        ? 'Your email address hasn\u2019t been confirmed yet. Please check your inbox for the confirmation email.'
        : 'Incorrect password. Please check it and try again, or use “Forgot password” to reset it.'
      return NextResponse.json({ error: friendly }, { status: 401 })
    }

    if (!authData?.user) {
      return NextResponse.json(
        { error: 'Could not sign you in. Please try again.' },
        { status: 401 }
      )
    }

    // Issue the signed member session cookie
    const claims = {
      role: 'member',
      member_id: mid,
      branch_id: member.branch_id ? Number(member.branch_id) : null,
      branch_code: member.branches?.code || '',
      name: member.full_name || '',
      auth_user_id: member.auth_user_id,
    }
    const sessionToken = await sign(claims, TOKEN_TTL)

    const res = NextResponse.json({ success: true, member: claims })
    res.cookies.set('member_token', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: TOKEN_TTL,
    })
    return res
  } catch (e) {
    console.error('Member login error:', e)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
