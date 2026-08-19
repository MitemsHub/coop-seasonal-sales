// app/api/admin/members/search/route.js
// Admin member lookup for the Members Settings module — find a member by
// staff ID, name or phone so staff can set/reset their details.
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
      .select('member_id, full_name, phone, savings, loans, global_limit, status, branch_id, branches:branch_id(name, code)')
      .or(`member_id.ilike.%${q}%,full_name.ilike.%${q}%,phone.ilike.%${q}%`)
      .order('member_id')
      .limit(25)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      members: (data || []).map((m) => ({
        member_id: m.member_id,
        full_name: m.full_name || '',
        phone: m.phone || '',
        savings: m.savings,
        loans: m.loans,
        global_limit: m.global_limit,
        status: m.status,
        branch_name: m.branches?.name || '',
        branch_code: m.branches?.code || '',
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to search members' }, { status: 500 })
  }
}
