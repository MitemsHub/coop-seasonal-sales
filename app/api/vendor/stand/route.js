// app/api/vendor/stand/route.js
// The vendor's stand profile: banner, where the stand is, when it is open, how
// to reach it, the minimum order and pickup instructions. Members see this on
// the stand page, so a thin page becomes a real shopfront.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIELDS = {
  banner_url: 500,
  stand_number: 40,
  hall: 60,
  opening_hours: 120,
  whatsapp: 30,
  pickup_instructions: 600,
}

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_vendors')
      .select('id, name, code, phone, address, banner_url, stand_number, hall, opening_hours, whatsapp, min_order, pickup_instructions')
      .eq('id', ctx.vendor_id)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ ok: false, error: 'Stand not found' }, { status: 404 })

    return NextResponse.json({ ok: true, stand: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load stand' }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const updates = {}
    for (const [key, max] of Object.entries(FIELDS)) {
      if (body[key] === undefined) continue
      updates[key] = String(body[key] ?? '').trim().slice(0, max)
    }
    if (body.min_order !== undefined) {
      updates.min_order = Math.max(0, Math.trunc(Number(body.min_order) || 0))
    }
    if (!Object.keys(updates).length) {
      return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_vendors')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', ctx.vendor_id)
      .select('id, name, code, phone, address, banner_url, stand_number, hall, opening_hours, whatsapp, min_order, pickup_instructions')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, stand: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to save stand' }, { status: 500 })
  }
}
