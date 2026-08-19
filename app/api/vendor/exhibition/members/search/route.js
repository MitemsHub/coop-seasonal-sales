import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    if (error) {
      if (String(error?.code || '') === '42P01') {
        return NextResponse.json({ ok: true, members: [] })
      }
      return NextResponse.json({ error: error.message || 'Search failed' }, { status: 500 })
    }

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
    return NextResponse.json({ error: e.message || 'Search failed' }, { status: 500 })
  }
}
