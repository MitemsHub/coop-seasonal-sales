// app/api/members/session/route.js
// Member session introspection + logout.
//   GET    — returns the current signed member session if a valid member_token
//            cookie is present (used to check "am I really authenticated?").
//   DELETE — clears the member_token cookie (server-side logout).
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'member')
  if (!session.valid) {
    return NextResponse.json({ ok: false, error: session.error || 'Not signed in' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, member: session.claims })
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('member_token', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
