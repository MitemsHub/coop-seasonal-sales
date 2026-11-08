// app/api/admin/exhibition/members/financials/route.js
// Admin counter-invoice desk: a member's savings, loans and the credit still
// available for the invoice's exhibition cycle. The exposure calculation is
// the same atomic function the order routes use, so the figure shown here is
// the figure the server will enforce when the invoice is submitted.
//   GET /api/admin/exhibition/members/financials?member_id=...&cycle_id=...
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const memberId = String(searchParams.get('member_id') || '').trim().toUpperCase()
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    if (!memberId) return NextResponse.json({ ok: false, error: 'Member ID is required' }, { status: 400 })

    const supabase = createClient()
    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('member_id, full_name, savings, loans, global_limit, category')
      .eq('member_id', memberId)
      .maybeSingle()

    if (memberError) return NextResponse.json({ ok: false, error: memberError.message }, { status: 500 })
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })

    // Prefer the cycle of the invoice being raised. Without one, fall back to
    // the newest active exhibition cycle.
    let cycle = null
    if (cycleId > 0) {
      const { data } = await supabase
        .from('exhibition_cycles')
        .select('id, name, code, status, starts_at, ends_at')
        .eq('id', cycleId)
        .maybeSingle()
      cycle = data || null
    } else {
      const { data } = await supabase
        .from('exhibition_cycles')
        .select('id, name, code, status, starts_at, ends_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      cycle = data || null
    }

    const savings = Number(member.savings || 0)
    const loans = Number(member.loans || 0)
    let exposure = null
    let warning = ''

    if (cycle?.id) {
      const { data, error } = await supabase.rpc('check_exhibition_exposure_atomic', {
        p_member_id: memberId,
        p_payment_option: 'Loan',
        p_total_amount: 0,
        p_cycle_id: Number(cycle.id),
      })
      if (error) {
        warning = error.message || 'Could not calculate the remaining credit facility.'
      } else if (data?.ok) {
        exposure = data
      } else {
        warning = data?.error || 'Could not calculate the remaining credit facility.'
      }
    } else {
      warning = 'No active exhibition cycle is available.'
    }

    return NextResponse.json({
      ok: true,
      member: {
        member_id: member.member_id,
        full_name: member.full_name || '',
        savings,
        loans,
        global_limit: Number(member.global_limit || 0),
        category: member.category || '',
      },
      cycle: cycle
        ? {
            id: Number(cycle.id),
            name: cycle.name || '',
            code: cycle.code || '',
            status: cycle.status || '',
            starts_at: cycle.starts_at || null,
            ends_at: cycle.ends_at || null,
          }
        : null,
      financials: {
        savings,
        loans,
        global_limit: Number(member.global_limit || 0),
        savings_eligible: Number(exposure?.savingsEligible || 0),
        loan_eligible: Number(exposure?.loanEligible || 0),
        outstanding_loans_total: Number(exposure?.outstandingLoansTotal ?? loans),
        savings_exposure: Number(exposure?.savingsExposure || 0),
        loan_exposure: Number(exposure?.loanExposure || 0),
        available: Boolean(exposure),
        warning: warning || '',
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load member financials' }, { status: 500 })
  }
}
