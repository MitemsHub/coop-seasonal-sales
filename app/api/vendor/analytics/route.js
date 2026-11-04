// app/api/vendor/analytics/route.js
// What the stand's shoppers actually did in the last 30 days: views, adds,
// add-to-cart rate, per-product leaders, and the searches that found nothing.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAYS = 30

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { data: events, error } = await supabase
      .from('exhibition_events')
      .select('event_type, product_id, created_at')
      .eq('vendor_id', ctx.vendor_id)
      .in('event_type', ['view', 'add'])
      .gte('created_at', since)
      .limit(5000)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const { data: products } = await supabase
      .from('exhibition_products')
      .select('id, name, vendor_price, admin_markup')
      .eq('vendor_id', ctx.vendor_id)

    const byProduct = new Map()
    let views = 0
    let adds = 0
    for (const e of events || []) {
      const pid = Number(e.product_id)
      if (!byProduct.has(pid)) byProduct.set(pid, { views: 0, adds: 0 })
      const row = byProduct.get(pid)
      if (e.event_type === 'view') {
        row.views++
        views++
      } else {
        row.adds++
        adds++
      }
    }

    const productRows = (products || [])
      .map((p) => {
        const s = byProduct.get(Number(p.id)) || { views: 0, adds: 0 }
        const price = Number(p.vendor_price || 0) + Number(p.admin_markup || 0)
        return {
          id: Number(p.id),
          name: p.name,
          price,
          views: s.views,
          adds: s.adds,
          rate: s.views > 0 ? Math.round((s.adds / s.views) * 100) : 0,
        }
      })
      .sort((a, b) => b.views - a.views)

    // What people searched for and the market could not answer.
    const { data: misses } = await supabase
      .from('exhibition_events')
      .select('query')
      .eq('event_type', 'search')
      .eq('results', 0)
      .gte('created_at', since)
      .limit(500)
    const missCounts = new Map()
    for (const m of misses || []) {
      const q = String(m.query || '').trim()
      if (!q) continue
      missCounts.set(q, (missCounts.get(q) || 0) + 1)
    }
    const emptySearches = [...missCounts.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return NextResponse.json({
      ok: true,
      days: DAYS,
      totals: {
        views,
        adds,
        conversion: views > 0 ? Math.round((adds / views) * 100) : 0,
        products: (products || []).length,
      },
      products: productRows,
      emptySearches,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load insights' }, { status: 500 })
  }
}
