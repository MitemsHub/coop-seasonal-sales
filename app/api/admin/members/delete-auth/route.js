// app/api/admin/members/delete-auth/route.js
// Admin action from Members Settings: delete a member's email (Supabase Auth)
// sign-up state so they can sign up again and set a fresh password — for the
// case "member can't remember their password and the reset email never
// arrives". Replaces the old routine of deleting the user by hand in the
// Supabase dashboard.
//
//   POST { member_id }
//     → deletes the linked auth users row (service-role admin API) and sets
//       members.auth_user_id = NULL. After this the member is "pending"
//       again: /api/members/auth/send-otp will treat them as never signed up
//       and the normal sign-up (OTP → set password) flow works end to end.
//
//   Deleting when the auth user is already gone (stale reference) still
//   clears the link — the action is idempotent.
//
// Deliberately does NOT touch members.password_hash: that is the separate
// local (staff-ID + password) sign-in for pensioners, resettable from the
// same modal's "Reset password" button.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { createClient as createAuthClient } from '@supabase/supabase-js'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const authAdmin = createAuthClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const memberId = String(body.member_id || '').trim().toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const supabase = createClient()
    const { data: member, error } = await supabase
      .from('members')
      .select('member_id, full_name, auth_user_id')
      .eq('member_id', memberId)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })

    const authUserId = member.auth_user_id
    if (!authUserId) {
      // Nothing linked — the member never completed sign-up. Already reset.
      return NextResponse.json({ ok: true, deleted: false, message: 'No email sign-up state on file — nothing to delete.' })
    }

    // Delete the Supabase Auth user first. If the dashboard already removed
    // it, the API says so — either way we should still clear the link.
    let authDeleted = false
    let authMsg = ''
    try {
      const { error: delErr } = await authAdmin.auth.admin.deleteUser(authUserId)
      if (!delErr) {
        authDeleted = true
      } else {
        const msg = (delErr.message || '').toLowerCase()
        if (msg.includes('not found') || msg.includes('404') || msg.includes('missing')) {
          authMsg = 'auth user was already gone; link cleared'
        } else {
          // Definitive failure to delete — don't half-apply: leave the link
          // intact so we don't orphan a live auth user pointing at nobody.
          return NextResponse.json({ ok: false, error: `Supabase Auth delete failed: ${delErr.message}` }, { status: 500 })
        }
      }
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Supabase Auth unreachable: ${e?.message || e}` }, { status: 502 })
    }

    const { error: linkErr } = await supabase
      .from('members')
      .update({ auth_user_id: null })
      .eq('member_id', memberId)
    if (linkErr) {
      // Auth user is deleted but the link remains — harmless (the member
      // check route cleans stale links automatically), but report it.
      return NextResponse.json({ ok: false, error: linkErr.message }, { status: 500 })
    }

    console.log(`[delete-auth] admin removed ${authDeleted ? '' : '(stale) '}sign-up state for ${memberId} (${member.full_name || 'no name'})`)

    return NextResponse.json({
      ok: true,
      deleted: true,
      member: { member_id: member.member_id, full_name: member.full_name || '' },
      message: authMsg || undefined,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to delete sign-up state' }, { status: 500 })
  }
}
