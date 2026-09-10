// app/api/members/auth/check/route.js
// Check if a member ID exists and whether they have a Supabase Auth account.
//   POST { memberId } → { exists, hasAuth, email }
//
// This endpoint is UNAUTHENTICATED (used during login) so it is protected
// by rate limiting to prevent account enumeration attacks.
//
// IMPORTANT: When a member has an auth_user_id, we verify the auth user
// actually exists in Supabase Auth. If it was deleted (e.g. from the Supabase
// dashboard), we clean the stale reference and treat them as a new user.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { createClient as createAuthClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Auth admin client to verify auth_user_ids
const authAdmin = createAuthClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function getClientIP(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || request.headers.get('x-vercel-forwarded-for') || 'unknown'
}

export async function POST(request) {
  try {
    const ip = getClientIP(request)

    // Rate limit: 10 checks per IP per minute (prevents brute-force ID enumeration)
    const limit = checkRateLimit('member-check', ip, 10, 60 * 1000)
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterMs)

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

    // If the member has an auth_user_id, verify it actually exists in Supabase Auth.
    // This catches the case where an admin deleted the auth user from the dashboard.
    let authIsValid = false
    if (member.auth_user_id) {
      try {
        const { data: authUser, error: authErr } = await authAdmin.auth.admin.getUserById(member.auth_user_id)
        if (authErr) {
          // API call succeeded but returned an error (e.g. user not found).
          // Only treat as invalid when the error is definitive — not on transient
          // network / timeout failures which could incorrectly wipe a valid link.
          const msg = (authErr.message || '').toLowerCase()
          const isDefinitive = msg.includes('not found') || msg.includes('404') || msg.includes('missing')
          if (isDefinitive) {
            authIsValid = false
          } else {
            // Transient or unknown error — assume the auth link is still valid
            // so the member can still attempt login.
            console.warn(`[member-check] Admin API error (keeping auth_user_id): ${authErr.message}`)
            authIsValid = true
          }
        } else if (authUser?.user?.id) {
          authIsValid = true
        }
      } catch (e) {
        // Network failure / timeout — keep the auth link intact rather than
        // silently destroying it, which would force a duplicate signup.
        console.warn(`[member-check] Admin API unreachable (keeping auth_user_id): ${e.message}`)
        authIsValid = true
      }

      // Clean up stale reference — only when the API confirmed the user is gone
      if (!authIsValid) {
        console.warn(`[member-check] Cleaning stale auth_user_id "${member.auth_user_id}" for member "${mid}"`)
        await supabase
          .from('members')
          .update({ auth_user_id: null })
          .eq('member_id', mid)
      }
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
      // hasAuth is only true if the auth user actually exists in Supabase Auth
      hasAuth: authIsValid,
      email: maskedEmail,
      // Only expose raw email if they have a valid auth account (for login flow)
      rawEmail: authIsValid ? rawEmail : null,
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
