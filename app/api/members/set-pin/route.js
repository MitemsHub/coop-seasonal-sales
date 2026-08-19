// app/api/members/set-pin/route.js
// Member PIN setup / change.
//   POST /api/members/set-pin  { memberId (or member_id), pin }
//
// Security: a signed member session token (issued by /api/members/verify-pin)
// is required to set a PIN for a member who already has one — the token's
// member_id must match the target member, so knowing another member's ID is
// no longer enough to overwrite their PIN and claim their account.
//
// The one exception is first-time setup: a member with NO PIN yet can set
// their initial PIN without a token (otherwise onboarding would be a
// deadlock — they have no PIN to verify against). That first set also issues
// the signed session token, so the onboarding flow ends with a live session.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { sign } from '@/lib/signingEdge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_TTL = 60 * 60 * 8

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const memberId = String(body.memberId || body.member_id || '').trim().toUpperCase()
    const pin = String(body.pin || '').trim()

    if (!memberId || !pin) {
      return NextResponse.json({ error: 'Member ID and PIN are required' }, { status: 400 })
    }
    if (!/^\d{4,5}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be 4-5 digits' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('member_id, pin, full_name, branch_id, branches:branch_id(code, name)')
      .eq('member_id', memberId)
      .maybeSingle()

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const hasPin = member.pin !== null && String(member.pin) !== ''

    // Changing an existing PIN requires an authenticated member session for
    // that exact member ID.
    if (hasPin) {
      const session = await validateSession(request, 'member')
      if (!session.valid) {
        return NextResponse.json(
          { error: 'Sign in with your PIN before changing it.' },
          { status: 401 }
        )
      }
      if (String(session.claims?.member_id || '').toUpperCase() !== memberId) {
        return NextResponse.json(
          { error: 'You can only change the PIN for your own member ID.' },
          { status: 403 }
        )
      }
    }

    const { error: updateError } = await supabase
      .from('members')
      .update({ pin })
      .eq('member_id', memberId)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // First-time setup authenticates the member — issue the same signed
    // session token so onboarding ends with a live, verifiable session.
    let token = null
    let claims = null
    if (!hasPin) {
      claims = {
        role: 'member',
        member_id: memberId,
        branch_id: member.branch_id ? Number(member.branch_id) : null,
        branch_code: member.branches?.code || '',
        name: member.full_name || '',
      }
      token = await sign(claims, TOKEN_TTL)
    }

    const res = NextResponse.json({ success: true, member: claims })
    if (token) {
      res.cookies.set('member_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: TOKEN_TTL,
      })
    }
    return res
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
