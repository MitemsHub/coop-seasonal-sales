// app/api/orders/[id]/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'
import { resolveMemberScope } from '../../../../lib/memberScope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req, { params }) {
  try {
    // A member only ever reads their own order; admins and reps may open any.
    const scope = await resolveMemberScope(_req, null, { allow: ['member', 'admin', 'rep'] })
    if (!scope.ok) return scope.response

    const supabase = createClient()
    const resolvedParams = await params
    const id = Number(resolvedParams?.id)
    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ ok: false, error: 'Invalid order id' }, { status: 400 })
    }

    const selectCols = `
      order_id,
      status,
      created_at,
      posted_at,
      payment_option,
      total_amount,
      cycle_id,
      member_id,
      member_name_snapshot,
      member_category_snapshot,
      branch_id,
      delivery_branch_id,
      delivery:delivery_branch_id(code,name,rep_phone),
      member_branch:branch_id(code,name),
      departments:department_id(name),
      order_lines(qty, unit_price, amount, items:item_id(sku, name))
    `

    const { data, error } = await supabase
      .from('orders')
      .select(selectCols)
      .eq('order_id', id)
      .single()

    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
    }

    if (scope.role === 'member' && String(data.member_id || '').trim().toUpperCase() !== scope.memberId) {
      return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })
    }

    // Hydrate branch names if nested joins didn't resolve
    const fixes = []
    if (!data.delivery && data.delivery_branch_id) {
      fixes.push(
        supabase.from('branches').select('code,name,rep_phone').eq('id', data.delivery_branch_id).single()
          .then(r => ({ key: 'delivery', val: r.data || null }))
      )
    }
    if (!data.member_branch && data.branch_id) {
      fixes.push(
        supabase.from('branches').select('code,name').eq('id', data.branch_id).single()
          .then(r => ({ key: 'member_branch', val: r.data || null }))
      )
    }
    if (fixes.length) {
      const rs = await Promise.all(fixes)
      for (const r of rs) if (r?.key) data[r.key] = r.val
    }

    const principal = Number((data.order_lines || []).reduce((s, l) => s + Number(l.amount || 0), 0))
    const interest = data.payment_option === 'Loan' ? Math.max(0, Number(data.total_amount || 0) - principal) : 0

    let loanInterestRatePct = 13
    try {
      if (data.cycle_id) {
        const { data: cRow, error: cErr } = await supabase
          .from('cycles')
          .select('food_loan_interest_rate_pct')
          .eq('id', data.cycle_id)
          .maybeSingle()
        if (!cErr && cRow && cRow.food_loan_interest_rate_pct != null) {
          loanInterestRatePct = Math.max(0, Number(cRow.food_loan_interest_rate_pct || 0))
        }
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      order: {
        ...data,
        principal_amount: principal,
        loan_interest_amount: interest,
        loan_interest_rate_pct: loanInterestRatePct,
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
