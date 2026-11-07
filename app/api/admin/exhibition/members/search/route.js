// app/api/admin/exhibition/members/search/route.js
// Member lookup for the admin counter-invoice desk. Mirrors the vendor search,
// but only an admin session may call it.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  const session = await validateSession(req, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const supabase = createClient()
    const q = String(req.nextUrl?.searchParams?.get('q') || '').trim()
    if (q.length < 2) return NextResponse.json({ ok: true, members: [] })

    const term = `%${q}%`
    const { data, error } = await supabase
      .from('members')
      .select('member_id, full_name, branch_id, branches:branch_id(name, code)')
      .or(`member_id.ilike.${term},full_name.ilike.${term}`)
      .order('member_id', { ascending: true })
      .limit(8)

    if (error) return NextResponse.json({ ok: false, error: error.message || 'Search failed' }, { status: 500 })

    return NextResponse.json({
      ok: true,
      members: (data || []).map((m) => ({
        member_id: m.member_id,
        full_name: m.full_name || '',
        branch: m.branches?.name || '',
        branch_code: m.branches?.code || '',
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Search failed' }, { status: 500 })
  }
}
