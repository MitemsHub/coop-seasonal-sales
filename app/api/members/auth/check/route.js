// app/api/members/auth/check/route.js
// Check if a member ID exists and whether they have a Supabase Auth account.
//   POST { memberId } → { exists, hasAuth, email }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const { memberId } = await request.json().catch(() => ({}))
    const mid = String(memberId || '').trim().toUpperCase()

    if (!mid) {
      return NextResponse.json({ error: 'Member ID is required' }, { status: 400 })
    }

    const supabase = createClient()

    // Use ilike for case-insensitive member_id lookup
    const { data: member, error } = await supabase
      .from('members')
      .select('member_id, email, auth_user_id')
      .ilike('member_id', mid)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!member) {
      return NextResponse.json({ exists: false, hasAuth: false, email: null })
    }

    // Mask email for display (e.g. j***n@example.com)
    const rawEmail = member.email || ''
    let maskedEmail = ''
    if (rawEmail && rawEmail.includes('@')) {
      const [local, domain] = rawEmail.split('@')
      maskedEmail =
        local.length > 2
          ? `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local[local.length - 1]}@${domain}`
          : `${local[0]}***@${domain}`
    }

    return NextResponse.json({
      exists: true,
      hasAuth: !!member.auth_user_id,
      email: maskedEmail,
      rawEmail: member.auth_user_id ? rawEmail : null, // only expose raw email if they have an auth account (for login)
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
