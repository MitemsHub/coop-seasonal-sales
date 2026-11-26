import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../_session'
import { ensureShelfCategories } from '@/lib/exhibitionShelfCategories'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    // A cycle starts with no categories, so the product form had nothing to
    // pick. The shop's shelves are created on first read instead.
    const data = await ensureShelfCategories(supabase, ctx.cycle_id)
    return NextResponse.json({ ok: true, categories: data })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load categories' }, { status: 500 })
  }
}
