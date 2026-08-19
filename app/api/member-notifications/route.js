// app/api/member-notifications/route.js
// Persistent notifications inbox for members.
//   GET   /api/member-notifications?member_id=XXX   → list (newest first)
//   POST  /api/member-notifications                 → record one event
//         body: { member_id, module, event, order_id, title, message }
//         dedupe_key = member_id:module:order_id:event, so re-observed
//         transitions (poll re-run, second tab) no-op instead of duplicating.
//   PATCH /api/member-notifications                 → mark read
//         body: { member_id, ids?: number[], all?: boolean }
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

    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 20)))

    const supabase = createClient()
    const { data, error } = await supabase
      .from('member_notifications')
      .select('id, module, event, order_id, title, message, is_read, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const unread = (data || []).filter((n) => !n.is_read).length
    return NextResponse.json({ ok: true, notifications: data || [], unread })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load notifications' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const memberId = normalizeMemberId(body.member_id)
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const moduleName = String(body.module || '').toLowerCase()
    if (moduleName !== 'food' && moduleName !== 'exhibition' && moduleName !== 'ram') {
      return NextResponse.json({ ok: false, error: 'module must be food, ram or exhibition' }, { status: 400 })
    }
    const event = String(body.event || '').trim()
    const orderId = String(body.order_id || '').trim()
    if (!event || !orderId) return NextResponse.json({ ok: false, error: 'event and order_id are required' }, { status: 400 })
    if (event.length > 40) return NextResponse.json({ ok: false, error: 'event is too long' }, { status: 400 })
    if (orderId.length > 40) return NextResponse.json({ ok: false, error: 'order_id is too long' }, { status: 400 })

    const title = String(body.title || '').trim().slice(0, 120)
    const message = String(body.message || '').trim().slice(0, 300)
    const dedupeKey = `${memberId}:${moduleName}:${orderId}:${event}`

    const supabase = createClient()
    const { data, error } = await supabase
      .from('member_notifications')
      .insert({ member_id: memberId, module: moduleName, event, order_id: orderId, title, message, dedupe_key: dedupeKey })
      .select('id, module, event, order_id, title, message, is_read, created_at')
      .maybeSingle()

    // A duplicate transition (already recorded) is not an error — the watcher
    // must be idempotent.
    const isDuplicate =
      error && (String(error.code || '') === '23505' || /duplicate/i.test(`${error.message || ''} ${error.details || ''}`))
    if (error && !isDuplicate) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, notification: data || null, duplicate: isDuplicate || !data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to record notification' }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const memberId = normalizeMemberId(body.member_id)
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const supabase = createClient()
    let q = supabase.from('member_notifications').update({ is_read: true }).eq('member_id', memberId)

    if (body.all !== true) {
      const ids = Array.isArray(body.ids) ? body.ids.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0) : []
      if (!ids.length) return NextResponse.json({ ok: false, error: 'ids or all is required' }, { status: 400 })
      q = q.in('id', ids)
    }

    const { error } = await q
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update notifications' }, { status: 500 })
  }
}
