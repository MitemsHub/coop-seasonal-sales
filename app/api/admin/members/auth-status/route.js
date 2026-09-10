// app/api/admin/members/auth-status/route.js
// Returns auth signup completion data for all members so the admin can
// see who has completed Supabase Auth registration vs who is still pending.
//
//   GET /api/admin/members/auth-status
//     ?status=signed_up|pending|all  (default: all)
//     &search=<name or id>           (optional fuzzy search)
//     &page=1&limit=50              (pagination, default page=1, limit=50)
//     &validate=true                (optional: revalidate auth_user_ids against Supabase Auth)
//
//   Response: { ok, members, stats: { total, signedUp, pending }, page, totalPages }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { createClient as createAuthClient } from '@supabase/supabase-js'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Auth admin client to validate auth_user_ids against Supabase Auth
const authAdmin = createAuthClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/**
 * Validate that a batch of auth_user_ids actually exist in Supabase Auth.
 * Returns a Set of valid IDs and cleans stale references in the members table.
 */
async function validateAuthUsers(authUserIds) {
  if (!authUserIds || authUserIds.length === 0) return new Set()

  const validIds = new Set()
  const staleIds = []

  // Check each auth_user_id (Supabase Auth admin API doesn't have a batch lookup,
  // so we check individually — limited to the page size, typically 50)
  for (const authUserId of authUserIds) {
    try {
      const { data, error } = await authAdmin.auth.admin.getUserById(authUserId)
      if (data?.user?.id) {
        validIds.add(authUserId)
      } else {
        staleIds.push(authUserId)
      }
    } catch {
      staleIds.push(authUserId)
    }
  }

  // Clean up stale references in the members table
  if (staleIds.length > 0) {
    console.warn(`[auth-status] Cleaning ${staleIds.length} stale auth_user_id references`)
    const db = createClient()
    // Set auth_user_id to NULL for members whose auth users no longer exist
    await db
      .from('members')
      .update({ auth_user_id: null })
      .in('auth_user_id', staleIds)
  }

  return validIds
}

export async function GET(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const status = url.searchParams.get('status') || 'all'
    const search = (url.searchParams.get('search') || '').trim()
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)))

    const supabase = createClient()

    // Build query — we only need a few columns
    let query = supabase
      .from('members')
      .select('member_id, full_name, email, auth_user_id, branch_id, branches:branch_id(code, name)', { count: 'exact' })

    // Filter by auth status (preliminary — may be adjusted after validation)
    if (status === 'signed_up') {
      query = query.not('auth_user_id', 'is', null)
    } else if (status === 'pending') {
      query = query.is('auth_user_id', null)
    }

    // Search filter
    if (search) {
      query = query.or(`member_id.ilike.%${search}%,full_name.ilike.%${search}%`)
    }

    // Get total count for stats (without pagination)
    const countQuery = supabase.from('members').select('auth_user_id', { count: 'exact', head: false })

    // Paginate
    const offset = (page - 1) * limit
    query = query.order('member_id', { ascending: true }).range(offset, offset + limit - 1)

    const { data: members, error, count } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Collect auth_user_ids from this page's results for validation
    const authUserIds = [...new Set(
      (members || [])
        .map(m => m.auth_user_id)
        .filter(Boolean)
    )]

    // Validate auth_user_ids against Supabase Auth and clean stale ones
    const validAuthIds = await validateAuthUsers(authUserIds)

    // Build display-friendly member list with validated status
    const allMembers = (members || []).map((m) => ({
      memberId: m.member_id,
      fullName: m.full_name || '',
      email: m.email || '',
      hasAuth: m.auth_user_id ? validAuthIds.has(m.auth_user_id) : false,
      branchCode: m.branches?.code || '',
      branchName: m.branches?.name || '',
    }))

    // Filter the member list based on the requested status.
    // After validation, some members with auth_user_id may have hasAuth=false
    // (stale reference). They should NOT appear in the "signed_up" list.
    let memberList = allMembers
    if (status === 'signed_up') {
      memberList = allMembers.filter((m) => m.hasAuth)
    } else if (status === 'pending') {
      // "pending" should include both null auth_user_id AND stale references
      // (hasAuth=false means the auth user was deleted)
      memberList = allMembers.filter((m) => !m.hasAuth)
    }

    // Get stats — total, signed up, pending (across all members, not filtered)
    // After cleanup, stale auth_user_ids are set to NULL, so the raw count
    // is now more accurate. We also re-count on this page to handle any
    // fresh cleanups that just happened.
    const [totalResult, signedUpResult] = await Promise.all([
      supabase.from('members').select('member_id', { count: 'exact', head: true }),
      supabase.from('members').select('member_id', { count: 'exact', head: true }).not('auth_user_id', 'is', null),
    ])

    const total = totalResult.count || 0
    const rawSignedUp = signedUpResult.count || 0

    // Adjust: subtract stale references we just cleaned on this page
    // (they were auth_user_id NOT NULL before cleanup, now NULL)
    const staleCountOnPage = (members || []).filter(
      (m) => m.auth_user_id && !validAuthIds.has(m.auth_user_id)
    ).length
    const signedUp = Math.max(0, rawSignedUp - staleCountOnPage)
    const pending = total - signedUp

    const totalPages = Math.ceil((count || 0) / limit)

    return NextResponse.json({
      ok: true,
      members: memberList,
      stats: { total, signedUp, pending },
      page,
      totalPages,
      count: status === 'all' ? (count || 0) : memberList.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
