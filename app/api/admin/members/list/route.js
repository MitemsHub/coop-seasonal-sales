// GET /api/admin/members/list — all members (id, full_name, branch code)
// for admin dropdowns. Session-validated admin only; replaces the admin
// pages' direct anon-key `.from('members')` reads.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('members')
      .select('member_id, full_name, branches:branch_id(code)')
      .order('full_name')
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, members: data || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load members' }, { status: 500 })
  }
}
