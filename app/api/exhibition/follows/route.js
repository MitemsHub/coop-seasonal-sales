// app/api/exhibition/follows/route.js
// Following a stand.
//   GET  ?member_id=XXX            → the member's followed stands
//   POST { member_id, vendor_id, follow: true|false }
//
// Followers are notified when the admin approves a new product for that stand
// (see lib/notifyStandFollowers.js) — a draft the vendor uploaded is never
// announced, because members cannot buy it yet.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateMemberId } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeMemberId(raw) {
  const res = validateMemberId(String(raw || ''))
  return res.isValid ? res.sanitized.toUpperCase() : ''
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const memberId = normalizeMemberId(searchParams.get('member_id'))
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_stand_follows')
      .select('vendor_id, created_at, vendor:exhibition_vendors(name)')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      vendors: (data || []).map((r) => ({
        vendor_id: Number(r.vendor_id),
        name: r.vendor?.name || '',
        since: r.created_at,
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load followed stands' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const memberId = normalizeMemberId(body.member_id)
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const vendorId = Math.trunc(Number(body.vendor_id))
    if (!Number.isFinite(vendorId) || vendorId <= 0) {
      return NextResponse.json({ ok: false, error: 'vendor_id is required' }, { status: 400 })
    }

    const supabase = createClient()
    const follow = body.follow !== false

    if (!follow) {
      const { error } = await supabase
        .from('exhibition_stand_follows')
        .delete()
        .eq('member_id', memberId)
        .eq('vendor_id', vendorId)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, following: false })
    }

    const { data: vendor } = await supabase.from('exhibition_vendors').select('id').eq('id', vendorId).maybeSingle()
    if (!vendor) return NextResponse.json({ ok: false, error: 'Stand not found' }, { status: 404 })

    const { error } = await supabase
      .from('exhibition_stand_follows')
      .insert({ member_id: memberId, vendor_id: vendorId })
    // Already following is a success, not an error.
    if (error && String(error.code || '') !== '23505' && !/duplicate/i.test(error.message || '')) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, following: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update follow' }, { status: 500 })
  }
}
