// app/api/members/verify-pin/route.js
// Member PIN verification. On success this issues a signed member session
// token (httpOnly `member_token` cookie) carrying { role: 'member',
// member_id, branch_id, branch_code, name } — the same signing scheme the
// rep/admin portals use. The token is what gates privileged member actions
// like setting/changing a PIN, so knowing another member's ID is no longer
// enough to claim their account.
//   POST /api/members/verify-pin  { memberId (or member_id), pin }
//   DELETE /api/members/verify-pin  — clears the member_token (logout)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { sign } from '@/lib/signingEdge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same 8h lifetime the rep/admin sessions use.
const TOKEN_TTL = 60 * 60 * 8

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('member_token', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    // Accept both field spellings (MemberLauncher sends memberId, the legacy
    // PinVerification component sent member_id).
    const memberId = String(body.memberId || body.member_id || '').trim().toUpperCase()
    const pin = String(body.pin || '').trim()

    if (!memberId || !pin) {
      return NextResponse.json({ error: 'Member ID and PIN are required' }, { status: 400 })
    }
    if (!/^\d{4,5}$/.test(pin)) {
      return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('members')
      .select('pin, full_name, branch_id, branches:branch_id(code, name)')
      .eq('member_id', memberId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (data.pin !== pin) {
      return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
    }

    // PIN verified — issue the signed member session token.
    const claims = {
      role: 'member',
      member_id: memberId,
      branch_id: data.branch_id ? Number(data.branch_id) : null,
      branch_code: data.branches?.code || '',
      name: data.full_name || '',
    }
    const token = await sign(claims, TOKEN_TTL)

    const res = NextResponse.json({ success: true, member: claims })
    res.cookies.set('member_token', token, {
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
