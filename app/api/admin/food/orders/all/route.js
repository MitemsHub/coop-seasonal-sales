// GET /api/admin/food/orders/all — every food order with the embedded
// joins the admin "All Member Orders" page renders: member, delivery
// branch, department and order lines with item info. Optional filters:
//   &member_id=XXXX   &status=Pending|Posted|Delivered|Cancelled
// Replaces the page's direct anon-key `.from('orders')` read so the
// orders/order_lines tables can be RLS deny-all.
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
    const status = String(searchParams.get('status') || '').trim()

    const supabase = createClient()

    let query = supabase
      .from('orders')
      .select(`
        *,
        members!inner(full_name, branch_code),
        branches!delivery_branch_code(name),
        departments(name),
        order_lines(
          id,
          qty,
          unit_price,
          amount,
          items(sku, name, unit)
        )
      `)
      .order('created_at', { ascending: false })

    if (memberId) query = query.eq('member_id', memberId)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, orders: data || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load orders' }, { status: 500 })
  }
}
