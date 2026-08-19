// app/api/admin/members/auth-status/route.js
// Returns auth signup completion data for all members so the admin can
// see who has completed Supabase Auth registration vs who is still pending.
//
//   GET /api/admin/members/auth-status
//     ?status=signed_up|pending|all  (default: all)
//     &search=<name or id>           (optional fuzzy search)
//     &page=1&limit=50              (pagination, default page=1, limit=50)
//
//   Response: { ok, members, stats: { total, signedUp, pending }, page, totalPages }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    // Filter by auth status
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

    // Apply same search filter to count query
    if (search) {
      // We'll compute stats separately
    }

    // Paginate
    const offset = (page - 1) * limit
    query = query.order('member_id', { ascending: true }).range(offset, offset + limit - 1)

    const { data: members, error, count } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get stats — total, signed up, pending (across all members, not filtered)
    const [totalResult, signedUpResult] = await Promise.all([
      supabase.from('members').select('member_id', { count: 'exact', head: true }),
      supabase.from('members').select('member_id', { count: 'exact', head: true }).not('auth_user_id', 'is', null),
    ])

    const total = totalResult.count || 0
    const signedUp = signedUpResult.count || 0
    const pending = total - signedUp

    const totalPages = Math.ceil((count || 0) / limit)

    // Build display-friendly member list
    const memberList = (members || []).map((m) => ({
      memberId: m.member_id,
      fullName: m.full_name || '',
      email: m.email || '',
      hasAuth: !!m.auth_user_id,
      branchCode: m.branches?.code || '',
      branchName: m.branches?.name || '',
    }))

    return NextResponse.json({
      ok: true,
      members: memberList,
      stats: { total, signedUp, pending },
      page,
      totalPages,
      count: count || 0,
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
