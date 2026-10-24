// app/api/admin/items/set-image/route.js
// Admin-only write for an item's image URL. Replaces the previous direct
// browser-side supabase.from('items').update(...) which RLS now (correctly)
// blocks on the public anon key. Validation + write happen server-side.
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const session = await validateSession(request, 'admin')
    if (!session.valid) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const itemId = Number(body?.item_id)
    let imageUrl = typeof body?.image_url === 'string' ? body.image_url.trim() : ''

    if (!Number.isFinite(itemId) || itemId <= 0) {
      return NextResponse.json({ ok: false, error: 'Valid item_id is required' }, { status: 400 })
    }
    if (!imageUrl) {
      return NextResponse.json({ ok: false, error: 'image_url is required' }, { status: 400 })
    }
    // Only same-project storage URLs or relative object paths are accepted —
    // never an arbitrary remote image that could be swapped out later.
    const u = (() => { try { return new URL(imageUrl) } catch { return null } })()
    if (u && !/\.supabase\.co$/.test(u.hostname)) {
      return NextResponse.json({ ok: false, error: 'image_url must be a Supabase storage URL' }, { status: 400 })
    }

    const supabase = createClient()
    const { error } = await supabase
      .from('items')
      .update({ image_url: imageUrl })
      .eq('item_id', itemId)

    if (error) {
      return NextResponse.json({ ok: false, error: error.message || 'Failed to update image' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, image_url: imageUrl })
  } catch (error) {
    console.error('POST /api/admin/items/set-image error:', error)
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to update image' }, { status: 500 })
  }
}
