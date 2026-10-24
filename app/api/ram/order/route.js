// GET /api/ram/order?id=123 — one RAM order with its member snapshot and
// delivery location. Serves the ram/success confirmation page, which used
// to read `ram_orders`, `members` and `ram_delivery_locations` directly
// with the anon browser client.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const idRaw = String(new URL(request.url).searchParams.get('id') || '').trim()
    const id = Number(idRaw)
    if (!idRaw || !Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })
    }

    const supabase = createClient()

    const { data: o, error: oErr } = await supabase
      .from('ram_orders')
      .select(
        'id,member_id,status,created_at,payment_option,qty,unit_price,principal_amount,interest_amount,total_amount,ram_delivery_location_id'
      )
      .eq('id', id)
      .maybeSingle()
    if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 })
    if (!o) return NextResponse.json({ ok: false, error: 'Order not found' }, { status: 404 })

    const [mRes, lRes] = await Promise.all([
      supabase
        .from('members')
        .select('member_id,full_name,branch_id')
        .eq('member_id', o.member_id)
        .maybeSingle(),
      o.ram_delivery_location_id
        ? supabase
            .from('ram_delivery_locations')
            .select('id,delivery_location,name,phone,address')
            .eq('id', o.ram_delivery_location_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    return NextResponse.json({
      ok: true,
      order: o,
      member: mRes?.data || null,
      location: lRes?.data || null,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load order' }, { status: 500 })
  }
}
