// app/api/vendor/stand/route.js
// The vendor's stand profile: banner, where the stand is, when it is open, how
// to reach it, the minimum order, pickup instructions and the "about" line
// members read on the stand card. Members see all of this on the stand page, so
// a thin page becomes a real shopfront.
//
// `about` arrives with migrations/add-exhibition-vendor-about.sql. Until that
// runs, GET fills it from the written profile copy and PATCH says so plainly
// instead of failing with a raw database error.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { vendorAbout } from '@/lib/exhibitionVendorCategories'
import { getVendorContext } from '../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLS =
  'id, name, code, phone, address, banner_url, stand_number, hall, opening_hours, whatsapp, min_order, pickup_instructions'

const FIELDS = {
  banner_url: 500,
  stand_number: 40,
  hall: 60,
  opening_hours: 120,
  whatsapp: 30,
  pickup_instructions: 600,
  about: 600,
}

const isMissingAbout = (err) =>
  String(err?.code || '') === '42703' && /about/i.test(String(err?.message || ''))

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    let { data, error } = await supabase
      .from('exhibition_vendors')
      .select(`${COLS}, about`)
      .eq('id', ctx.vendor_id)
      .maybeSingle()
    if (isMissingAbout(error)) {
      ;({ data, error } = await supabase
        .from('exhibition_vendors')
        .select(COLS)
        .eq('id', ctx.vendor_id)
        .maybeSingle())
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ ok: false, error: 'Stand not found' }, { status: 404 })

    return NextResponse.json({ ok: true, stand: { ...data, about: data.about || vendorAbout(data.name) } })
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
      .select(COLS)
      .single()
    if (error) {
      if (isMissingAbout(error)) {
        return NextResponse.json(
          { ok: false, error: 'The stand profile needs its “about” column first — run migrations/add-exhibition-vendor-about.sql, then save again.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, stand: { ...data, about: updates.about ?? vendorAbout(data.name) } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to save stand' }, { status: 500 })
  }
}
