// app/api/members/session/route.js
// Member session introspection + logout.
//   GET    — returns the current signed member session if a valid member_token
//            cookie is present (used to check "am I really authenticated?").
//   DELETE — clears the member_token cookie (server-side logout).
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'member')
  if (!session.valid) {
    return NextResponse.json({ ok: false, error: session.error || 'Not signed in' }, { status: 401 })
  }

  // A member excluded from the latest official import loses portal access even
  // with a session cookie issued before they were excluded.
  try {
    const supabase = createClient()
    const { data: memberRow } = await supabase
      .from('members')
      .select('portal_enabled')
      .eq('member_id', session.claims?.member_id || '')
      .maybeSingle()
    if (memberRow && memberRow.portal_enabled === false) {
      return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
    }
  } catch {
    // DB hiccup — don't lock out existing members on a transient failure
  }

  return NextResponse.json({ ok: true, member: session.claims })
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('member_token', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
