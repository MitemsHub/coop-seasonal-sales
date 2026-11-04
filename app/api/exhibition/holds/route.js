// app/api/exhibition/holds/route.js
// The exhibition cart's 10-minute courtesy hold.
//
//   POST   { member_id, branch_code, lines: [{ product_id, qty }] }
//          Replaces the member's holds with this cart and returns expires_at.
//   GET    ?member_id=XXX   → the member's live holds
//   DELETE { member_id }    → release everything (empty cart, sign-out)
//
// A hold never decrements exhibition_products.qty. Checkout still reserves
// stock atomically (exhibition_reserve_stock) and deletes the hold first, so a
// unit is never counted twice. Holds only decide what the catalogue advertises
// as available to *other* members while someone is checking out.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateMemberId, validateNumber } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOLD_MINUTES = 10
const MAX_LINES = 60

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
      .from('exhibition_stock_holds')
      .select('product_id, qty, expires_at')
      .eq('member_id', memberId)
      .gt('expires_at', new Date().toISOString())
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const expiresAt = (data || []).reduce((min, r) => (!min || r.expires_at < min ? r.expires_at : min), null)
    return NextResponse.json({ ok: true, holds: data || [], expires_at: expiresAt })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load holds' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const memberId = normalizeMemberId(body.member_id)
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const linesRaw = Array.isArray(body.lines) ? body.lines : []
    if (linesRaw.length > MAX_LINES) return NextResponse.json({ ok: false, error: 'Too many items to hold' }, { status: 400 })

    const lines = []
    for (const l of linesRaw) {
      const pid = Math.trunc(Number(l?.product_id))
      const qtyRes = validateNumber(l?.qty, { min: 1, max: 9999, integer: true })
      if (!Number.isFinite(pid) || pid <= 0 || !qtyRes.isValid) {
        return NextResponse.json({ ok: false, error: 'Invalid item in the cart' }, { status: 400 })
      }
      lines.push({ product_id: pid, qty: qtyRes.value })
    }

    const supabase = createClient()

    // Clearing first makes this endpoint idempotent: the call always describes
    // the whole cart, not one line.
    await supabase.from('exhibition_stock_holds').delete().eq('member_id', memberId)

    if (!lines.length) return NextResponse.json({ ok: true, holds: [], expires_at: null })

    const { data: member } = await supabase
      .from('members')
      .select('member_id, portal_enabled')
      .eq('member_id', memberId)
      .maybeSingle()
    if (!member || member.portal_enabled === false) {
      return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })
    }

    const { data: cycle } = await supabase
      .from('exhibition_cycles')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!cycle) return NextResponse.json({ ok: true, holds: [], expires_at: null })

    // The cart belongs to the branch the member chose; fall back to the one the
    // catalogue served when the cart holds a branch code the member never set.
    const branchCode = String(body.branch_code || '').trim().toUpperCase()
    let branchId = null
    if (branchCode) {
      const { data: branch } = await supabase.from('branches').select('id').eq('code', branchCode).maybeSingle()
      branchId = branch?.id ? Number(branch.id) : null
    }

    const ids = lines.map((l) => l.product_id)
    const { data: products, error: pErr } = await supabase
      .from('exhibition_products')
      .select('id, name, qty, status, cycle_id, branch_id')
      .eq('cycle_id', Number(cycle.id))
      .in('id', ids)
    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })

    const byId = new Map((products || []).map((p) => [Number(p.id), p]))

    // Units other members are holding, so the check matches what the catalogue
    // shows them.
    const { data: otherHolds } = await supabase
      .from('exhibition_stock_holds')
      .select('product_id, qty')
      .in('product_id', ids)
      .gt('expires_at', new Date().toISOString())
    const heldByOthers = new Map()
    for (const h of otherHolds || []) {
      heldByOthers.set(Number(h.product_id), (heldByOthers.get(Number(h.product_id)) || 0) + Number(h.qty || 0))
    }

    for (const l of lines) {
      const p = byId.get(l.product_id)
      if (!p || p.status !== 'active') {
        return NextResponse.json({ ok: false, error: 'An item in your cart is no longer available.' }, { status: 409 })
      }
      if (branchId && Number(p.branch_id) !== branchId) {
        return NextResponse.json({ ok: false, error: 'An item in your cart is not sold at this pickup point.' }, { status: 409 })
      }
      if (p.qty !== null && Number(p.qty) - (heldByOthers.get(l.product_id) || 0) < l.qty) {
        const left = Math.max(0, Number(p.qty) - (heldByOthers.get(l.product_id) || 0))
        return NextResponse.json(
          { ok: false, error: `Only ${left} left of “${p.name}” — someone else is holding the rest.` },
          { status: 409 }
        )
      }
    }

    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString()
    const { error: insErr } = await supabase.from('exhibition_stock_holds').insert(
      lines.map((l) => ({
        cycle_id: Number(cycle.id),
        product_id: l.product_id,
        member_id: memberId,
        qty: l.qty,
        expires_at: expiresAt,
      }))
    )
    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, holds: lines, expires_at: expiresAt, hold_minutes: HOLD_MINUTES })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to hold stock' }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const memberId = normalizeMemberId(body.member_id)
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const supabase = createClient()
    const { error } = await supabase.from('exhibition_stock_holds').delete().eq('member_id', memberId)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to release holds' }, { status: 500 })
  }
}
