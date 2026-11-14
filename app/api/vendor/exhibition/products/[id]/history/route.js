// app/api/vendor/exhibition/products/[id]/history/route.js
// A product's price history — what it was, what it became, who changed it.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req, { params }) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Invalid product' }, { status: 400 })

    const supabase = createClient()
    const { data: product } = await supabase
      .from('exhibition_products')
      .select('id, vendor_id')
      .eq('id', id)
      .maybeSingle()
    if (!product || Number(product.vendor_id) !== Number(ctx.vendor_id)) {
      return NextResponse.json({ ok: false, error: 'Product not found' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('exhibition_price_history')
      .select('id, old_vendor_price, new_vendor_price, changed_by, changed_by_label, note, created_at')
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, history: data || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load history' }, { status: 500 })
  }
}
