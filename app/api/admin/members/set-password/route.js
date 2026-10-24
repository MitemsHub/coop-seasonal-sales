// app/api/admin/members/set-password/route.js
// Admin sets (or resets) a LOCAL portal password for a member, so they can
// sign in with Staff ID + password alone — no email needed.
//   POST { member_id, password } → { ok }
//
// Intended for pensioners ("P"-prefixed IDs): 99% have no email, so the
// standard OTP-by-email signup flow can never onboard them. The hash lands
// in members.password_hash (lib/localPassword.js, scrypt) and the member's
// next sign-in is verified locally (see /api/members/auth/login).
//
// SECURITY: admin session required. The route deliberately does NOT accept
// non-"P" members — those should onboard through the email OTP flow instead.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { hashPassword } from '@/lib/localPassword'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const memberId = String(body.member_id || '').trim().toUpperCase()
    const password = String(body.password || '')

    if (!memberId) {
      return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })
    }
    if (!memberId.startsWith('P')) {
      return NextResponse.json(
        { ok: false, error: 'Local passwords are only for pensioner accounts (IDs starting with P)' },
        { status: 400 }
      )
    }
    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }
    if (password.length > 72) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at most 72 characters' },
        { status: 400 }
      )
    }

    const supabase = createClient()

    const { data: member, error: mErr } = await supabase
      .from('members')
      .select('member_id, full_name, portal_enabled')
      .ilike('member_id', memberId)
      .maybeSingle()
    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 })
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })
    if (member.portal_enabled === false) {
      return NextResponse.json(
        { ok: false, error: 'This member is excluded from portal access (not in the current member list)' },
        { status: 403 }
      )
    }

    let passwordHash
    try {
      passwordHash = hashPassword(password)
    } catch (e) {
      return NextResponse.json({ ok: false, error: e.message || 'Could not hash password' }, { status: 400 })
    }

    const { error: updateErr } = await supabase
      .from('members')
      .update({ password_hash: passwordHash, password_set_at: new Date().toISOString() })
      .eq('member_id', member.member_id)
      .select('member_id')
      .maybeSingle()

    if (updateErr) {
      console.error('[admin set-password] update failed:', updateErr)
      return NextResponse.json({ ok: false, error: 'Failed to save the password' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      member: {
        member_id: member.member_id,
        full_name: member.full_name || '',
      },
    })
  } catch (e) {
    console.error('[admin set-password] unexpected error:', e)
    return NextResponse.json({ ok: false, error: e.message || 'Failed to set password' }, { status: 500 })
  }
}
