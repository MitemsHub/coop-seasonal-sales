// app/api/members/auth/forgot-password/route.js
// Send a password-reset email to the member's registered email.
//   POST { memberId } → { ok }
//
// We look up the member by ID, then use Supabase Auth to send the reset link.
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createDbClient } from '@/lib/supabaseServer'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const authSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  try {
    const { memberId } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }

    // Rate limit: 3 reset requests per member per 10 minutes
    const resetLimit = checkRateLimit('forgot-pw', mid, 3, 10 * 60 * 1000)
    if (!resetLimit.allowed) return rateLimitResponse(resetLimit.retryAfterMs)

    // Look up the member's email
    const db = createDbClient()
    const { data: member, error: mErr } = await db
      .from('members')
      .select('member_id, email, auth_user_id')
      .eq('member_id', mid)
      .maybeSingle()

    if (mErr) {
      return NextResponse.json({ error: mErr.message }, { status: 500 })
    }
    if (!member) {
      // Don't reveal whether the member exists — return a generic success
      return NextResponse.json({ ok: true })
    }
    if (!member.auth_user_id || !member.email) {
      // No auth account — still return success to avoid leaking info
      return NextResponse.json({ ok: true })
    }

    // Send the password reset email via Supabase Auth
    const { error: resetError } = await authSupabase.auth.resetPasswordForEmail(member.email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ''}/reset-password`,
    })

    if (resetError) {
      console.error('Password reset error:', resetError)
      // Still return success to avoid leaking info
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
