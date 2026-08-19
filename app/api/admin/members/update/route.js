// app/api/admin/members/update/route.js
// Admin set/reset of a member's details from Members Settings — name, phone,
// PIN (set a fresh one, or clear it to null when the member forgot it). The
// PIN is stored like the member's own set-pin flow; it is never echoed back.
//   PATCH { member_id, full_name?, phone?, pin?, clear_pin? }
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function cleanText(v, maxLen = 160) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

export async function PATCH(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const memberId = String(body.member_id || '').trim().toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const patch = {}
    if (body.full_name !== undefined) {
      const fullName = cleanText(body.full_name, 160)
      if (!fullName) return NextResponse.json({ ok: false, error: 'Name cannot be empty' }, { status: 400 })
      patch.full_name = sanitizeString(fullName, { maxLength: 160, encodeHtml: false })
    }
    if (body.phone !== undefined) {
      patch.phone = cleanText(body.phone, 30)
    }
    if (body.clear_pin === true || body.clear_pin === 'true') {
      patch.pin = null
    } else if (body.pin !== undefined && String(body.pin) !== '') {
      const pin = String(body.pin).replace(/\D/g, '').slice(0, 8)
      if (pin.length < 4) return NextResponse.json({ ok: false, error: 'PIN must be at least 4 digits' }, { status: 400 })
      patch.pin = pin
    }

    const moneyField = (v) => {
      if (v === undefined || v === null || v === '') return null
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) throw new Error('Amounts must be non-negative numbers')
      return Math.round(n * 100) / 100
    }
    if (body.savings !== undefined) {
      const savings = moneyField(body.savings)
      if (savings !== null) patch.savings = savings
    }
    if (body.loans !== undefined) {
      const loans = moneyField(body.loans)
      if (loans !== null) patch.loans = loans
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('members')
      .update(patch)
      .eq('member_id', memberId)
      .select('member_id, full_name, phone, savings, loans, pin, status')
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })

    return NextResponse.json({
      ok: true,
      member: {
        member_id: data.member_id,
        full_name: data.full_name || '',
        phone: data.phone || '',
        savings: data.savings,
        loans: data.loans,
        status: data.status,
        // Masked: only whether a PIN is currently set.
        pin: data.pin != null && String(data.pin) !== '' ? 'set' : 'not set',
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update member' }, { status: 500 })
  }
}
