// app/api/members/auth/self-set-password/route.js
// First-time SELF-SERVICE password setup for pensioners ("P"-prefixed IDs).
//   POST { memberId, password } → { success, member }
//
// 99% of pensioners have no email, so the OTP-by-email signup flow can never
// onboard them. Instead of the old "visit the admin office" step, a P member
// whose account has NO password and NO auth account yet may create their own
// password directly from the sign-in card.
//
// SECURITY MODEL:
//   • Only a genuine first-time setup is allowed — the route refuses when
//     password_hash is already set or a Supabase Auth account exists. From
//     then on the password can only be changed by the admin
//     (/api/admin/members/set-password), so this endpoint can never be used
//     as a re-set/hijack path for a claimed account.
//   • Rate-limited per IP to slow ID probing.
//   • The hash uses lib/localPassword.js (scrypt) — same as the admin route.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { hashPassword } from '@/lib/localPassword'
import { sign } from '@/lib/signingEdge'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_TTL = 60 * 60 * 8

function getClientIP(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'unknown'
}

export async function POST(request) {
  try {
    const ip = getClientIP(request)

    // Rate limit: 5 setup attempts per IP per 10 minutes
    const limit = checkRateLimit('member-self-set-password', ip, 5, 10 * 60 * 1000)
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterMs)

    const { memberId, password } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()
    const pw = String(password || '')

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }
    if (!mid.startsWith('P')) {
      return NextResponse.json(
        { error: 'Self-service password setup is available to pensioner members (IDs starting with P). Members with email should use the normal sign-up flow.' },
        { status: 403 }
      )
    }
    if (pw.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }
    if (pw.length > 72) {
      return NextResponse.json({ error: 'Password must be at most 72 characters' }, { status: 400 })
    }

    const db = createClient()
    const { data: member, error: mErr } = await db
      .from('members')
      .select('member_id, full_name, branch_id, portal_enabled, password_hash, auth_user_id, branches:branch_id(code, name)')
      .ilike('member_id', mid)
      .maybeSingle()

    if (mErr) {
      console.error('[self-set-password] member lookup failed:', mErr)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
    if (!member) {
      return NextResponse.json({ error: 'No member account found for that Staff ID. Please check it and try again.' }, { status: 404 })
    }
    // Members excluded from the latest official member import can't sign in.
    if (member.portal_enabled === false) {
      return NextResponse.json({ error: 'No member account found for that Staff ID. Please check it and try again.' }, { status: 404 })
    }
    // First-time only. An already-claimed account must never be re-set here.
    if (member.password_hash) {
      return NextResponse.json(
        { error: 'Your password is already set up. If you forgot it, please ask the co-op admin to reset it for you.' },
        { status: 409 }
      )
    }
    if (member.auth_user_id) {
      return NextResponse.json(
        { error: 'This account is already linked to an email account. Please sign in with your account password, or ask the admin for help.' },
        { status: 409 }
      )
    }

    let passwordHash
    try {
      passwordHash = hashPassword(pw)
    } catch (e) {
      return NextResponse.json({ error: e.message || 'Could not hash password' }, { status: 400 })
    }

    // Guard against a concurrent claim: only update while the hash is still
    // empty. Two simultaneous first-time set-ups cannot both win.
    const { data: updated, error: updErr } = await db
      .from('members')
      .update({ password_hash: passwordHash, password_set_at: new Date().toISOString() })
      .ilike('member_id', mid)
      .is('password_hash', null)
      .select('member_id')
      .maybeSingle()

    if (updErr) {
      console.error('[self-set-password] update failed:', updErr)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
    if (!updated) {
      // password_hash became non-null between the check and the update —
      // someone else (usually the admin) claimed it first.
      return NextResponse.json(
        { error: 'Your password is already set up. If you forgot it, please ask the co-op admin to reset it for you.' },
        { status: 409 }
      )
    }

    // Issue the same signed member session cookie the other flows use.
    const claims = {
      role: 'member',
      member_id: member.member_id,
      branch_id: member.branch_id ? Number(member.branch_id) : null,
      branch_code: member.branches?.code || '',
      name: member.full_name || '',
      auth_user_id: null,
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
    console.error('[self-set-password] unexpected error:', e)
    return NextResponse.json({ error: e.message || 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
