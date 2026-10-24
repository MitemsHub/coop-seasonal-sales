// app/api/admin/members/update/route.js
// Admin update of a member's details from Members Settings — name, phone,
// email, savings, loans, portal access, and a per-member global loan limit.
//   PATCH { member_id, full_name?, phone?, email?, savings?, loans?,
//           portal_enabled?, global_limit? }
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
    if (body.email !== undefined) {
      const emailAddr = String(body.email || '').trim().toLowerCase()
      if (emailAddr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr)) {
        return NextResponse.json({ ok: false, error: 'Invalid email address' }, { status: 400 })
      }
      patch.email = emailAddr || null
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
    if (body.portal_enabled !== undefined) {
      patch.portal_enabled = Boolean(body.portal_enabled)
    }
    if (body.global_limit !== undefined && body.global_limit !== null && String(body.global_limit) !== '') {
      const limit = Number(body.global_limit)
      if (!Number.isFinite(limit) || limit < 0) throw new Error('Global limit must be a non-negative number')
      patch.global_limit = Math.round(limit * 100) / 100
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('members')
      .update(patch)
      .eq('member_id', memberId)
      .select('member_id, full_name, phone, email, savings, loans, global_limit, status, portal_enabled')
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })

    return NextResponse.json({
      ok: true,
      member: {
        member_id: data.member_id,
        full_name: data.full_name || '',
        phone: data.phone || '',
        email: data.email || '',
        savings: data.savings,
        loans: data.loans,
        global_limit: data.global_limit,
        status: data.status,
        portal_enabled: data.portal_enabled !== false,
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update member' }, { status: 500 })
  }
}
