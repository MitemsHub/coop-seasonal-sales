import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient()

    const { data, error } = await supabase
      .from('exhibition_categories')
      .select('id, name, sort_order')
      .eq('cycle_id', ctx.cycle_id)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      if (String(error?.code || '') === '42P01') return NextResponse.json({ ok: true, categories: [] })
      return NextResponse.json({ error: error.message || 'Failed to load categories' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, categories: data || [] })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed to load categories' }, { status: 500 })
  }
}
