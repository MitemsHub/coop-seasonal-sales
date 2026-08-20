// app/api/exhibition/catalog/route.js
// Member-facing catalog for the Coop Exhibition shop.
//   GET /api/exhibition/catalog?member_id=XXX
// Returns the exhibition catalog: active cycle, vendors, categories and
// active products.  The exhibition is GLOBALLY visible — any member can
// browse and shop from any open exhibition.  The cycle's branch is the
// delivery/pickup location, not a visibility filter.
// Each product carries:
//   - final_price  = vendor_price + admin_markup (the catalog price)
//   - price        = the price THIS member pays (their negotiated price wins)
//   - negotiated   = true when a per-member price overrides the catalog
// When no cycle is active, returns { ok: true, open: false } so the shop
// can show the shared closed-module panel.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const memberId = String(searchParams.get('member_id') || '').trim().toUpperCase()
    if (!memberId) return NextResponse.json({ ok: false, error: 'member_id is required' }, { status: 400 })

    const supabase = createClient()

    // Member lookup — still needed for negotiated prices and member info,
    // but no longer used to filter which exhibitions are visible.
    const { data: member, error: mErr } = await supabase
      .from('members')
      .select('member_id, full_name, branch_id, branches:branch_id(code, name)')
      .eq('member_id', memberId)
      .maybeSingle()
    if (mErr) {
      if (isMissingTable(mErr, 'exhibition')) {
        return NextResponse.json(
          { ok: false, error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 })
    }
    if (!member) return NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 })

    // ── Find the most recent active cycle across ALL branches ──────
    // The exhibition is globally visible: any member can browse any open
    // exhibition.  The cycle's branch is the delivery/pickup location.
    const { data: active } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, starts_at, ends_at, loan_interest_rate_pct, branch_id, branches:branch_id(code, name)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .maybeSingle()

    // Fallback to the latest cycle (any status) so the UI can still show
    // draft/closed season info (e.g. "opens on …").
    const { data: latest } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, starts_at, ends_at, loan_interest_rate_pct, branch_id, branches:branch_id(code, name)')
      .order('created_at', { ascending: false })
      .maybeSingle()

    const cycle = active || latest
    if (!cycle) {
      return NextResponse.json({ ok: true, open: false, branch: '' })
    }

    let cycleOpen = cycle.status === 'active'
    const cycleId = Number(cycle.id)
    const cycleBranchId = Number(cycle.branch_id)
    const deliveryBranch = cycle.branches?.name || ''

    const [vendorsRes, categoriesRes, productsRes] = await Promise.all([
      supabase
        .from('exhibition_vendors')
        .select('id, name, code, phone, address')
        .eq('cycle_id', cycleId)
        .eq('status', 'active')
        .order('name'),
      supabase
        .from('exhibition_categories')
        .select('id, name')
        .eq('cycle_id', cycleId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('exhibition_products')
        .select('id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, admin_markup, qty, image_url, status, vendors:vendor_id(name, code), categories:category_id(name)')
        .eq('cycle_id', cycleId)
        .eq('status', 'active')
        .order('name'),
    ])

    if (productsRes.error && isMissingTable(productsRes.error, 'exhibition')) {
      return NextResponse.json(
        { ok: false, error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' },
        { status: 500 }
      )
    }
    if (productsRes.error) return NextResponse.json({ ok: false, error: productsRes.error.message }, { status: 500 })

    const products = productsRes.data || []
    const productIds = products.map((p) => p.id)

    // Per-member negotiated prices for this member's products (the person who
    // beats a price gets their own price — everyone else sees the catalog).
    let negotiated = new Map()
    if (productIds.length) {
      const { data: priceRows } = await supabase
        .from('exhibition_member_prices')
        .select('product_id, price, note')
        .eq('cycle_id', cycleId)
        .eq('member_id', memberId)
        .in('product_id', productIds)
      negotiated = new Map((priceRows || []).map((r) => [Number(r.product_id), r]))
    }

    const catalogProducts = products.map((p) => {
      const base = Number(p.vendor_price || 0) + Number(p.admin_markup || 0)
      const neg = negotiated.get(Number(p.id))
      const price = neg ? Math.max(0, Number(neg.price || 0)) : base
      return {
        id: Number(p.id),
        vendor_id: Number(p.vendor_id),
        vendor_name: p.vendors?.name || '',
        category_id: p.category_id ? Number(p.category_id) : null,
        category_name: p.categories?.name || '',
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        price,
        final_price: base,
        negotiated: !!neg,
        negotiated_note: neg?.note || '',
        qty: p.qty === null ? null : Number(p.qty),
        image_url: p.image_url || '',
      }
    })

    return NextResponse.json({
      ok: true,
      open: cycleOpen,
      branch: deliveryBranch,
      cycle: {
        id: cycleId,
        name: cycle.name || '',
        code: cycle.code || '',
        status: cycle.status || 'draft',
        loan_interest_rate_pct: Number(cycle.loan_interest_rate_pct ?? 13),
        starts_at: cycle.starts_at || null,
        ends_at: cycle.ends_at || null,
      },
      vendors: (vendorsRes.data || []).map((v) => ({
        id: Number(v.id),
        name: v.name || '',
        code: v.code || '',
        phone: v.phone || '',
        address: v.address || '',
      })),
      categories: (categoriesRes.data || []).map((c) => ({ id: Number(c.id), name: c.name || '' })),
      products: catalogProducts,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load exhibition' }, { status: 500 })
  }
}
