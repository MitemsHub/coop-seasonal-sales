// app/api/admin/members/search/route.js
// Admin member lookup for the Members Settings module — find a member by
// staff ID, name or phone so staff can set/reset their details.
// Also exposes has_password (boolean) so the admin can see and reset a
// pensioner's local portal password from this singular view.
//   GET /api/admin/members/search?q=...
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const q = String(new URL(request.url).searchParams.get('q') || '').trim()
    if (q.length < 2) return NextResponse.json({ ok: true, members: [] })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('members')
      .select('member_id, full_name, phone, email, savings, loans, global_limit, grade, status, portal_enabled, password_hash, auth_user_id, branch_id, branches:branch_id(name, code)')
      .or(`member_id.ilike.%${q}%,full_name.ilike.%${q}%,phone.ilike.%${q}%`)
      .order('member_id')
      .limit(25)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const response = NextResponse.json({
      ok: true,
      members: (data || []).map((m) => ({
        member_id: m.member_id,
        full_name: m.full_name || '',
        phone: m.phone || '',
        email: m.email || '',
        savings: m.savings,
        loans: m.loans,
        global_limit: m.global_limit,
        // Staff status/rank (Director, Senior Supervisor 1, …) — drives the
        // member's global limit via the grade_limits defaults
        grade: m.grade || '',
        status: m.status,
        portal_enabled: m.portal_enabled !== false,
        // Never expose the hash itself — only whether the member has one
        has_password: Boolean(m.password_hash),
        // Whether the member has completed email (OTP) sign-up — used by the
        // admin "delete sign-up state" action, never the auth user id itself
        has_auth: Boolean(m.auth_user_id),
        branch_name: m.branches?.name || '',
        branch_code: m.branches?.code || '',
      })),
    })

    // Prevent browser/CDN caching of member data — always fresh
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')

    return response
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to search members' }, { status: 500 })
  }
}
