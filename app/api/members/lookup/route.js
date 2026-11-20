// GET /api/members/lookup?member_id=XXX — a minimal member snapshot.
// This is a member-scoped read routed through the server (service role)
// so the members table can have RLS deny-all — the browser must never
// query `members` with the anon key directly.
// Returns the same join shape the old direct `.from('members')` reads used:
// { ok, member: { member_id, full_name, savings, loans, global_limit,
//   category, grade, phone, branches:{code,name}, departments:{name} } }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { resolveMemberScope, normalizeMemberId } from '@/lib/memberScope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    // Whose record may this call read? Ownership comes from the signed session:
    // a member is pinned to their own id, admins may name a member for the
    // assisted shop/cart, and anyone else is refused.
    const requested = new URL(request.url).searchParams.get('member_id')
    const scope = await resolveMemberScope(request, requested, {
      allow: ['member', 'admin'],
      signedOutError: 'Please sign in to view member details.',
    })
    if (!scope.ok) return scope.response

    const memberId = normalizeMemberId(scope.memberId)
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const supabase = createClient()

    const base = supabase
      .from('members')
      .select(`
        member_id,
        full_name,
        savings,
        loans,
        global_limit,
        category,
        grade,
        phone,
        branches:branch_id(code, name),
        departments:department_id(name)
      `)
      .eq('member_id', memberId)

    let { data, error } = await base.maybeSingle()
    // Graceful fallback if `grade`/`phone` columns are absent.
    if (error && /column|does not exist/i.test(error.message || '')) {
      ;({ data, error } = await supabase
        .from('members')
        .select(`
          member_id,
          full_name,
          savings,
          loans,
          global_limit,
          category,
          branches:branch_id(code, name),
          departments:department_id(name)
        `)
        .eq('member_id', memberId)
        .maybeSingle())
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    if (!data) return NextResponse.json({ ok: true, member: null })
    return NextResponse.json({ ok: true, member: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load member' }, { status: 500 })
  }
}
