// app/api/admin/members/history/route.js
// Admin view of a member's savings/loan balance trail, newest first.
//   GET /api/admin/members/history?member_id=A18441&limit=20&offset=0
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLS = 'id, member_id, old_savings, new_savings, old_loans, new_loans, source, changed_by, note, changed_at'

export async function GET(req) {
  const session = await validateSession(req, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const memberId = String(searchParams.get('member_id') || '').trim().toUpperCase()
  if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 20), 1), 200)
  const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

  try {
    const supabase = createClient()
    const { data, error, count } = await supabase
      .from('member_balance_history')
      .select(COLS, { count: 'exact' })
      .eq('member_id', memberId)
      .order('changed_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      // The table is new; say what to run rather than failing opaquely.
      const message = /relation .* does not exist|Could not find the table/i.test(error.message || '')
        ? 'Balance history is not set up yet. Run migrations/add-member-balance-history.sql in Supabase.'
        : error.message
      return NextResponse.json({ ok: false, error: message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, events: data || [], total: count || 0 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load balance history' }, { status: 500 })
  }
}
