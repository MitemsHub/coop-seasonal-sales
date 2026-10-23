// app/api/admin/members/excluded/route.js
// Members Settings — "Excluded members" list: every member currently marked
// portal_enabled = false (i.e. invisible to the member portal), with a
// one-click re-enable.
//
//   GET  { limit? }            → { ok, members: [...], total }
//   POST { member_id | ids }   → { ok, enabled }  (sets portal_enabled = true)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const limitRaw = Number(new URL(request.url).searchParams.get('limit') || 500)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 1000) : 500

    const supabase = createClient()
    const select = 'member_id, full_name, phone, email, grade, savings, loans, status, branch_id, branches:branch_id(name, code)'

    const { data, error, count } = await supabase
      .from('members')
      .select(select, { count: 'exact' })
      .eq('portal_enabled', false)
      .order('member_id')
      .limit(limit)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const response = NextResponse.json({
      ok: true,
      total: count ?? (data || []).length,
      members: (data || []).map((m) => ({
        member_id: m.member_id,
        full_name: m.full_name || '',
        phone: m.phone || '',
        email: m.email || '',
        grade: m.grade || '',
        savings: m.savings,
        loans: m.loans,
        status: m.status,
        branch_name: m.branches?.name || '',
        branch_code: m.branches?.code || '',
      })),
    })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load excluded members' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    // Accept a single member_id or an ids array (bulk re-enable from the
    // select-all checkbox).
    let ids = []
    if (Array.isArray(body?.ids)) ids = body.ids
    else if (body?.member_id) ids = [body.member_id]
    ids = [...new Set(ids.map((id) => String(id || '').trim().toUpperCase()).filter(Boolean))]
    if (!ids.length) return NextResponse.json({ ok: false, error: 'member_id or ids is required' }, { status: 400 })
    if (ids.length > 1000) return NextResponse.json({ ok: false, error: 'Too many IDs (max 1000 per request)' }, { status: 400 })

    const supabase = createClient()
    let enabled = 0
    for (const part of chunk(ids, 500)) {
      // count: 'exact' on an update comes back null in supabase-js v2 — fall
      // back to the length of the selected rows.
      const { data, error, count } = await supabase
        .from('members')
        .update({ portal_enabled: true })
        .in('member_id', part)
        .select('member_id')
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      enabled += count ?? (data || []).length
    }

    return NextResponse.json({ ok: true, enabled, requested: ids.length })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to re-enable members' }, { status: 500 })
  }
}

const chunk = (arr, size = 500) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
