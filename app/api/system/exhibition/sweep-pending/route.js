// app/api/system/exhibition/sweep-pending/route.js
// Releases stock held by exhibition orders that were placed but never approved.
//
// Checkout reserves units immediately; if a member abandons the order the units
// stay reserved until a rep cancels by hand, which can strand inventory on a
// busy exhibition day. Run this on a schedule (x-cron-secret) or as an admin.
//
//   POST /api/system/exhibition/sweep-pending?hours=48
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { releaseOrdersStock } from '@/lib/exhibitionStock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_HOURS = 48
const MAX_BATCH = 200

export async function GET(request) {
  return POST(request)
}

export async function POST(request) {
  try {
    // Scheduled runs present the cron secret; humans need an admin session.
    // Vercel Cron authenticates with `Authorization: Bearer <CRON_SECRET>`;
    // manual runs can send x-cron-secret instead.
    const cronSecret = process.env.CRON_SECRET
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const presented = request.headers.get('x-cron-secret') || bearer
    const viaCron = Boolean(cronSecret) && presented === cronSecret
    if (!viaCron) {
      const session = await validateSession(request, 'admin')
      if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const hours = Math.max(1, Math.trunc(Number(searchParams.get('hours') || DEFAULT_HOURS)))
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    const supabase = createClient()
    const { data: stale, error } = await supabase
      .from('exhibition_orders')
      .select('id, order_id')
      .eq('status', 'Pending')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(MAX_BATCH)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!stale?.length) return NextResponse.json({ ok: true, swept: 0, orders: [] })

    const ids = stale.map((o) => Number(o.id))
    const { error: updErr } = await supabase
      .from('exhibition_orders')
      .update({
        status: 'Cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_reason: `Auto-cancelled: still Pending after ${hours}h`,
      })
      .in('id', ids)
      .eq('status', 'Pending')
    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 })

    // Hand the reserved units back to the catalogue.
    const released = await releaseOrdersStock(supabase, ids)

    return NextResponse.json({
      ok: true,
      swept: ids.length,
      orders: stale.map((o) => o.order_id),
      stockReleased: Boolean(released?.ok),
      warning: released?.ok ? undefined : released?.error,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Sweep failed' }, { status: 500 })
  }
}
