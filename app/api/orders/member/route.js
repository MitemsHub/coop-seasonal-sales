// app/api/orders/member/route.js
// GET ?member_id=XXX — a member's food orders.
//
// Ownership comes from the signed session: a member only ever sees their own
// orders, whatever member_id the URL carries. Admins and reps may name another
// member (reps stay narrowed to their delivery branch).
import { NextResponse } from 'next/server'
// Service-role client: this route validates its own admin/rep session and must
// keep working under full RLS, which the anon-key cookie client would not
// bypass.
import { createClient } from '../../../../lib/supabaseServer'
import { resolveMemberScope } from '../../../../lib/memberScope'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const statusOnly = searchParams.get('status_only') === '1'

    const scope = await resolveMemberScope(request, searchParams.get('member_id'), {
      allow: ['member', 'admin', 'rep'],
    })
    if (!scope.ok) return scope.response

    const memberId = scope.memberId
    const role = scope.role
    const branch_id = scope.claims?.branch_id || null

    if (!memberId) {
      return NextResponse.json({ ok: false, error: 'Member ID is required' }, { status: 400 })
    }

    const supabase = createClient()

    let query = supabase
      .from('orders')
      .select(
        statusOnly
          ? 'order_id, status'
          : `
        *,
        order_lines (
          *,
          items (
            item_id,
            sku,
            name,
            unit,
            category
          )
        ),
        branches!orders_branch_id_fkey (
          name,
          code
        ),
        delivery:delivery_branch_id (
          name,
          code
        ),
        departments (
          name
        )
      `
      )
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })

    // The member's own list hides cancelled orders, but the slim status view
    // must NOT: the watcher detects cancellations from an explicit
    // Posted→Cancelled transition, and a row disappearing from the response
    // used to be read as a cancellation.
    if (!statusOnly) {
      query = query.neq('status', 'Cancelled')
    }

    // A rep looking at another member's orders only sees their delivery branch.
    if (role === 'rep' && branch_id && !scope.isOwn) {
      query = query.eq('delivery_branch_id', branch_id)
    }

    const { data: orders, error } = await query

    if (error) {
      console.error('Fetch member orders error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to fetch orders' }, { status: 500 })
    }

    const rows = Array.isArray(orders) ? orders : []

    let hasLoanRate = false
    try {
      const probe = await supabase.from('cycles').select('food_loan_interest_rate_pct').limit(1)
      hasLoanRate = !probe.error
    } catch {
      hasLoanRate = false
    }

    const cycleIds = Array.from(
      new Set(
        rows
          .map((o) => o?.cycle_id)
          .filter((id) => id != null && Number.isFinite(Number(id)) && Number(id) > 0)
          .map((id) => Number(id))
      )
    )

    const rateByCycleId = new Map()
    if (hasLoanRate && cycleIds.length > 0) {
      const { data: cycles, error: cErr } = await supabase
        .from('cycles')
        .select('id, food_loan_interest_rate_pct')
        .in('id', cycleIds)

      if (!cErr && Array.isArray(cycles)) {
        for (const c of cycles) {
          rateByCycleId.set(Number(c.id), Math.max(0, Number(c.food_loan_interest_rate_pct || 0)))
        }
      }
    }

    const enriched = rows.map((o) => {
      const lines = Array.isArray(o.order_lines) ? o.order_lines : []
      const principal = lines.reduce((sum, l) => sum + Number(l?.amount || 0), 0)
      const total = Number(o?.total_amount || 0)
      const interest = o?.payment_option === 'Loan' ? Math.max(0, total - principal) : 0
      const ratePct = hasLoanRate ? (rateByCycleId.get(Number(o?.cycle_id)) ?? 0) : 13
      return {
        ...o,
        principal_amount: principal,
        loan_interest_amount: interest,
        loan_interest_rate_pct: Math.max(0, Number(ratePct || 0)),
      }
    })

    const response = NextResponse.json({ ok: true, orders: enriched })
    
    // Add headers for better Chrome compatibility
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    
    return response
  } catch (error) {
    console.error('Member orders API error:', error)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
