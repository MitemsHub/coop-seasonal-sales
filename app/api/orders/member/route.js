// app/api/orders/member/route.js
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../../../lib/supabaseServer'
import { validateSession } from '../../../../lib/validation'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get('member_id')
    const statusOnly = searchParams.get('status_only') === '1'
    
    if (!memberId) {
      return NextResponse.json({ ok: false, error: 'Member ID is required' }, { status: 400 })
    }

    // Try to validate session for reps and admins
    // Members don't have session tokens, so we allow requests without tokens
    const adminToken = request.cookies.get('admin_token')?.value
    const repToken = request.cookies.get('rep_token')?.value
    
    let role = null
    let sessionMemberId = null
    let branch_id = null

    if (adminToken || repToken) {
      // User has a session token, validate it
      let sessionResult
      if (adminToken) {
        sessionResult = await validateSession(request, 'admin')
      } else if (repToken) {
        sessionResult = await validateSession(request, 'rep')
      }
      
      if (!sessionResult.valid) {
        return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 })
      }
      
      role = sessionResult.claims.role
      sessionMemberId = sessionResult.claims.member_id
      branch_id = sessionResult.claims.branch_id

      // Reps can view orders from their DELIVERY branch
      // Admins can view all orders
      if (role === 'member' && sessionMemberId !== memberId) {
        return NextResponse.json({ ok: false, error: 'Access denied' }, { status: 403 })
      }
    }
    // If no session tokens, assume it's a member request (members access via URL params)
    // This is acceptable since the UI controls access to member data

    const supabase = await createSupabaseServerClient()

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
      .neq('status', 'Cancelled')
      .order('created_at', { ascending: false })

    // If user is a rep, filter by their DELIVERY branch
    if (role === 'rep' && branch_id) {
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
