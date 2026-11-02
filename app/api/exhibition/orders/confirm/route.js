// app/api/exhibition/orders/confirm/route.js
// POST /api/exhibition/orders/confirm  — the member confirms they received
// their exhibition order.
//
// The pipeline is Pending → Approved → Delivered → Confirmed. A vendor (or an
// admin) marks Delivered when the goods leave the stand; only the member can
// move an order from Delivered to Confirmed, and that is what finalises the
// transaction. Identification comes from the signed member session — never from
// the request body — so one member cannot confirm another member's order.
//
// body: { order_id: 'EXH-2026-XXXXXX' }   (the display id the member sees)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'
import { logExhibitionAudit } from '@/lib/exhibitionAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sessionMemberId(claims) {
  const raw = claims?.member_id || claims?.staff_id || claims?.sub || ''
  return String(raw).trim().toUpperCase()
}

export async function POST(request) {
  try {
    const session = await validateSession(request, 'member')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Please sign in to confirm your order.' }, { status: 401 })
    }
    const memberId = sessionMemberId(session.claims)
    if (!memberId) {
      return NextResponse.json({ ok: false, error: 'Your session is missing a member id. Please sign in again.' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const orderId = String(body?.order_id || body?.orderId || '').trim().toUpperCase()
    if (!orderId) {
      return NextResponse.json({ ok: false, error: 'Order id is required' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: order, error } = await supabase
      .from('exhibition_orders')
      .select('id, order_id, member_id, status, delivered_at, member_confirmed_at')
      .eq('order_id', orderId)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!order) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    // Ownership is decided by the session, not by anything the client sent.
    if (String(order.member_id || '').toUpperCase() !== memberId) {
      return NextResponse.json({ ok: false, error: 'This order does not belong to your account.' }, { status: 403 })
    }

    // Idempotent: a second tap is a success, not an error.
    if (order.status === 'Confirmed') {
      return NextResponse.json({ ok: true, already: true, status: 'Confirmed', confirmed_at: order.member_confirmed_at })
    }

    if (order.status === 'Cancelled') {
      return NextResponse.json({ ok: false, error: 'This order was cancelled, so there is nothing to confirm.' }, { status: 409 })
    }

    // You can only confirm something that was actually handed over.
    if (order.status !== 'Delivered') {
      return NextResponse.json(
        {
          ok: false,
          error: 'You can confirm receipt once the goods have been marked delivered.',
          status: order.status,
        },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const { error: upErr } = await supabase
      .from('exhibition_orders')
      .update({
        status: 'Confirmed',
        member_confirmed_at: now,
        member_confirmed_by: memberId,
        updated_at: now,
      })
      .eq('id', order.id)
      .eq('member_id', order.member_id)
      .eq('status', 'Delivered')
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

    await logExhibitionAudit([order.id], {
      action: 'Confirmed',
      actorType: 'member',
      actorLabel: `Member · ${memberId}`,
    })

    return NextResponse.json({ ok: true, status: 'Confirmed', confirmed_at: now })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to confirm receipt' }, { status: 500 })
  }
}
