// app/api/exhibition/eligibility/route.js
// Read-only exhibition eligibility for the storefront: the same numbers
// checkout enforces (annual limit minus loans taken, with the category /
// pensioner / retiree rules). The RPC is called with a zero amount, so it
// locks the member row, returns the figures and spends nothing.
//   GET /api/exhibition/eligibility?member_id=A12345
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const memberId = String(searchParams.get('member_id') || '').trim()
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const supabase = createClient()
    const { data: member } = await supabase
      .from('members')
      .select('member_id, portal_enabled')
      .eq('member_id', memberId)
      .maybeSingle()
    if (!member || member.portal_enabled === false) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })
    }

    // The season is org-wide; take the live one (status active + open window).
    const { data: cycles, error: cErr } = await supabase
      .from('exhibition_cycles')
      .select('id, starts_at, ends_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(2)
    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 })

    const now = Date.now()
    const cycle = (cycles || []).find((c) => {
      if (c.starts_at && new Date(c.starts_at).getTime() > now) return false
      if (c.ends_at && new Date(c.ends_at).getTime() <= now) return false
      return true
    })
    if (!cycle) {
      return NextResponse.json({
        ok: true,
        open: false,
        eligibility: { savingsEligible: 0, loanEligible: 0 },
      })
    }

    const { data, error } = await supabase.rpc('check_exhibition_exposure_atomic', {
      p_member_id: memberId,
      p_payment_option: 'Loan',
      p_total_amount: 0,
      p_cycle_id: Number(cycle.id),
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data?.ok) {
      return NextResponse.json({ ok: false, error: data?.error || 'Could not check eligibility' }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      open: true,
      cycle: { id: cycle.id },
      eligibility: {
        savingsEligible: Number(data.savingsEligible || 0),
        loanEligible: Number(data.loanEligible || 0),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to check eligibility' }, { status: 500 })
  }
}
