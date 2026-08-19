import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const { count: productCount } = await supabase
      .from('exhibition_products')
      .select('id', { count: 'exact', head: true })
      .eq('vendor_id', ctx.vendor_id)
      .eq('status', 'active')

    const { count: liveProductCount } = await supabase
      .from('exhibition_products')
      .select('id', { count: 'exact', head: true })
      .eq('vendor_id', ctx.vendor_id)
      .eq('status', 'active')
      .not('image_url', 'is', null)
      .neq('image_url', '')

    // My lines grouped by their order status
    const { data: lines } = await supabase
      .from('exhibition_order_lines')
      .select('amount, delivered, orders:order_id(status)')
      .eq('vendor_id', ctx.vendor_id)

    const byStatus = { Pending: 0, Approved: 0, Delivered: 0, Cancelled: 0 }
    let revenue = 0
    let pendingAmount = 0
    let deliveredQty = 0
    let handoverPending = 0
    for (const line of lines || []) {
      const status = line.orders?.status || 'Pending'
      if (byStatus[status] !== undefined) byStatus[status]++
      const amt = Number(line.amount || 0)
      if (status === 'Approved' || status === 'Delivered') revenue += amt
      if (status === 'Pending') pendingAmount += amt
      if (line.delivered) deliveredQty++
      // Approved lines this vendor still needs to hand over
      if (status === 'Approved' && !line.delivered) handoverPending++
    }

    return NextResponse.json({
      ok: true,
      stats: {
        product_count: productCount || 0,
        live_products: liveProductCount || 0,
        orders: byStatus,
        revenue,
        pending_amount: pendingAmount,
        delivered_lines: deliveredQty,
        handover_pending: handoverPending,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load stats' }, { status: 500 })
  }
}
