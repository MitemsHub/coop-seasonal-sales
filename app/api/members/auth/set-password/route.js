// app/api/members/auth/set-password/route.js
// Set a password for the member's Supabase Auth account, completing signup.
//   POST { memberId, accessToken, password } → { ok, member }
//
// After the member verified their OTP, this endpoint:
// 1. Uses the access token to set their password via Supabase Auth
// 2. Links the Supabase Auth user ID to the member record in the members table
// 3. Issues a signed session cookie (member_token)
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createDbClient } from '@/lib/supabaseServer'
import { sign } from '@/lib/signingEdge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_TTL = 60 * 60 * 8 // 8 hours

// Service-role client — bypasses RLS and session requirements.
// Safe here because the member already verified their identity via OTP.
const authAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  try {
    const { memberId, accessToken, password } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()
    const token = String(accessToken || '').trim()
    const pw = String(password || '')

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }
    if (!token) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }
    if (!pw || pw.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    // Look up the Supabase Auth user by the access token to get the user ID.
    // Then use the service-role client to set the password (no session needed).
    const { data: { user: authUser }, error: tokenErr } = await authAdmin.auth.getUser(token)

    if (tokenErr || !authUser?.id) {
      console.error('Token lookup error:', tokenErr)
      return NextResponse.json(
        { error: 'Invalid or expired verification. Please go back and request a new code.' },
        { status: 401 }
      )
    }

    // Set the password using the service-role client
    const { data: userData, error: pwError } = await authAdmin.auth.admin.updateUserById(
      authUser.id,
      { password: pw }
    )

    if (pwError) {
      console.error('Set password error:', pwError)
      return NextResponse.json(
        { error: pwError.message || 'Failed to set password' },
        { status: 500 }
      )
    }

    if (!userData?.user?.id) {
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 500 }
      )
    }

    const authUserId = userData.user.id

    // Link the Supabase Auth user to the member record
    const db = createDbClient()
    const { error: linkError } = await db
      .from('members')
      .update({
        auth_user_id: authUserId,
        email: userData.user.email,
      })
      .eq('member_id', mid)

    if (linkError) {
      console.error('Link auth user error:', linkError)
      return NextResponse.json(
        { error: 'Failed to link account to member record' },
        { status: 500 }
      )
    }

    // Fetch member details for the session token
    const { data: member } = await db
      .from('members')
      .select('member_id, full_name, branch_id, branches:branch_id(code, name)')
      .eq('member_id', mid)
      .maybeSingle()

    // Issue the signed member session cookie
    const claims = {
      role: 'member',
      member_id: mid,
      branch_id: member?.branch_id ? Number(member.branch_id) : null,
      branch_code: member?.branches?.code || '',
      name: member?.full_name || '',
      auth_user_id: authUserId,
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
