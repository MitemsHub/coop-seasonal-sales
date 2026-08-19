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
      .select('member_id, email, auth_user_id, full_name, branch_id, branches:branch_id(code, name)')
      .eq('member_id', mid)
      .maybeSingle()

    if (mErr) {
      return NextResponse.json({ error: mErr.message }, { status: 500 })
    }
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
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
      return NextResponse.json(
        { error: authError.message || 'Invalid email or password' },
        { status: 401 }
      )
    }

    if (!authData?.user) {
      return NextResponse.json({ error: 'Login failed' }, { status: 401 })
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
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
