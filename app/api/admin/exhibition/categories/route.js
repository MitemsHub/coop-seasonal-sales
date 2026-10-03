// app/api/admin/exhibition/categories/route.js
// Admin read of exhibition categories (used by the products page category
// select). Categories are created alongside cycles; admins just list them.
//   GET — list categories (filter: cycle_id)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))

    const supabase = createClient()
    let query = supabase
      .from('exhibition_categories')
      .select('id, cycle_id, name, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (cycleId > 0) query = query.eq('cycle_id', cycleId)

    const { data, error } = await query
    if (error) {
      // Table not created yet (module never migrated) — render an empty select.
      if (String(error?.code || '') === '42P01') return NextResponse.json({ ok: true, categories: [] })
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, categories: data || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load categories' }, { status: 500 })
  }
}
