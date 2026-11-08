// app/api/vendor/exhibition/members/financials/route.js
// Admin-only compatibility endpoint. The vendor invoice desk no longer calls
// this route, and member financials must never be exposed to vendor sessions.
//   GET /api/vendor/exhibition/members/financials?member_id=...
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  const session = await validateSession(req, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const memberId = String(req.nextUrl?.searchParams?.get('member_id') || '').trim().toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'Member ID is required' }, { status: 400 })

    const supabase = createClient()
    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('member_id, savings, loans')
      .eq('member_id', memberId)
      .maybeSingle()

    if (memberError) return NextResponse.json({ ok: false, error: memberError.message }, { status: 500 })
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })

    const { data: cycle, error: cycleError } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, starts_at, ends_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (cycleError) return NextResponse.json({ ok: false, error: cycleError.message }, { status: 500 })
    if (!cycle?.id) {
      return NextResponse.json({ ok: false, error: 'No active exhibition cycle is available.' }, { status: 409 })
    }

    const loans = Number(member.loans || 0)
    const { data: exposure, error: exposureError } = await supabase.rpc('check_exhibition_exposure_atomic', {
      p_member_id: memberId,
      p_payment_option: 'Loan',
      p_total_amount: 0,
      p_cycle_id: Number(cycle.id),
    })
    if (exposureError) return NextResponse.json({ ok: false, error: exposureError.message }, { status: 500 })
    if (!exposure?.ok) {
      return NextResponse.json({ ok: false, error: exposure?.error || 'Could not calculate the member’s financial position.' }, { status: 409 })
    }

    return NextResponse.json({
      ok: true,
      cycle: {
        id: Number(cycle.id),
        name: cycle.name || '',
        code: cycle.code || '',
      },
      financials: {
        savings_eligible: Number(exposure.savingsEligible || 0),
        loan_eligible: Number(exposure.loanEligible || 0),
        outstanding_loans_total: Number(exposure.outstandingLoansTotal ?? loans),
        available: true,
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load member financials' }, { status: 500 })
  }
}
