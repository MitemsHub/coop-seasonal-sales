// app/api/exhibition/orders/route.js
// Member exhibition invoice history. Counter invoices are created by the
// vendor or admin APIs; the old online catalogue checkout is retired.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

// Statuses that still consume this cycle's loan allowance. Delivered and
// Confirmed orders have already been spent — excluding them would free the cap.

// GET /api/exhibition/orders?member_id=XXX — the member's exhibition orders
// with their lines (used by the confirmation + any member-facing view).
// Pass &status_only=1 to fetch just order_id + status (used by the member's
// status-toast poll so it stays light).
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const memberId = String(searchParams.get('member_id') || '').trim().toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const statusOnly = searchParams.get('status_only') === '1'
    const supabase = createClient()
    const { data: orders, error } = await supabase
      .from('exhibition_orders')
      .select(
        statusOnly
          ? 'id, order_id, status'
          : 'id, order_id, status, payment_option, total_qty, total_amount, created_at, approved_at, ready_at, delivered_at, cancelled_at, cancelled_reason, member_confirmed_at, member_name_snapshot, branch:branches(id, name, code), lines:exhibition_order_lines(id, vendor_id, product_name, sku, unit, final_price, qty, amount, vendor:exhibition_vendors(name))'
      )
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
    if (error) {
      if (isMissingTable(error, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      orders: (orders || []).map((o) => ({
        ...o,
        lines: (o.lines || []).map((l) => {
          const { vendor, ...rest } = l
          return {
            ...rest,
            vendor_name: vendor?.name || '',
          }
        }),
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load orders' }, { status: 500 })
  }
}

