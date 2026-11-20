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

    const { data: lines, error } = await supabase
      .from('exhibition_order_lines')
      .select('amount, orders:order_id(status)')
      .eq('vendor_id', ctx.vendor_id)
    // A failed query must not pass for an empty one: this endpoint drives the
    // dashboard's order and earnings cards, so zeros would be a lie.
    if (error) {
      console.error('Vendor stats query failed:', error)
      return NextResponse.json(
        { ok: false, error: error.message || 'Failed to load dashboard figures' },
        { status: 500 }
      )
    }

    const byStatus = { Pending: 0, Approved: 0, Confirmed: 0, Cancelled: 0 }
    let revenue = 0
    let pendingAmount = 0
    let confirmedLines = 0
    let awaitingConfirmation = 0

    for (const line of lines || []) {
      const status = line.orders?.status || 'Pending'
      // Only count the four known states. This must test the key, not the
      // count: `!byStatus[status]` is true while the counter is still 0, so it
      // skipped every line and the dashboard could never leave zero.
      if (byStatus[status] === undefined) continue
      byStatus[status] += 1
      const amt = Number(line.amount || 0)
      if (status === 'Approved' || status === 'Confirmed') revenue += amt
      if (status === 'Pending') pendingAmount += amt
      if (status === 'Confirmed') confirmedLines += 1
      if (status === 'Approved') awaitingConfirmation += 1
    }

    return NextResponse.json({
      ok: true,
      stats: {
        orders: byStatus,
        revenue,
        pending_amount: pendingAmount,
        confirmed_lines: confirmedLines,
        awaiting_confirmation: awaitingConfirmation,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load stats' }, { status: 500 })
  }
}
