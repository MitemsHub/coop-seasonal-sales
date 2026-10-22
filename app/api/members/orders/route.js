// app/api/members/orders/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const memberId = (searchParams.get('id') || '').trim()
    const status = (searchParams.get('status') || '').trim()
    const limit = Number(searchParams.get('limit') || 100)
    if (!memberId) return NextResponse.json({ ok:false, error:'id required' }, { status:400 })

    // Members excluded from the latest official member import can't fetch
    // portal data — unknown-ID treatment, consistent with the auth routes.
    const { data: memberRow, error: rowErr } = await supabase
      .from('members')
      .select('portal_enabled')
      .eq('member_id', memberId)
      .maybeSingle()
    if (rowErr || !memberRow || memberRow.portal_enabled === false) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })
    }

    const selectCols = `
      order_id, created_at, posted_at, status, payment_option, total_amount,
      delivery:delivery_branch_id(code,name),
      member_branch:branch_id(code,name),
      departments:department_id(name),
      order_lines(qty, unit_price, amount, items:item_id(sku,name))
    `

    let q = supabase
      .from('orders')
      .select(selectCols)
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) q = q.eq('status', status)
    else q = q.neq('status', 'Cancelled')

    const { data, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, orders: data || [] })
  } catch (e) {
    return NextResponse.json({ ok:false, error: e.message }, { status:500 })
  }
}
