// app/api/exhibition/catalog/route.js
// Member-facing catalog for the Coop Exhibition shop.
//   GET /api/exhibition/catalog?member_id=XXX
// Returns the exhibition catalog: active cycle, vendors, categories and
// active products.  The exhibition is GLOBALLY visible — any member can
// browse and shop from any open exhibition.  The cycle's branch is the
// delivery/pickup location, not a visibility filter.
// Each product carries:
//   - final_price  = vendor_price (the catalog price)
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

// ── Member-independent catalog cache ─────────────────────────────────
// The cycle, vendors, categories and products are identical for every member,
// so rebuilding them per request is wasted work — and on a busy exhibition day
// this route is what every member hits. Cache the result per cycle for a
// minute. Failures are never cached. Process-local by design: each instance
// warms once instead of querying on every page view.
const CORE_TTL_MS = 60_000
const coreCache = new Map() // cycleId -> { at, data }

async function loadCatalogCore(supabase, cycleId) {
  const hit = coreCache.get(cycleId)
  if (hit && Date.now() - hit.at < CORE_TTL_MS) return hit.data

  const [vendorsRes, categoriesRes, productsRes] = await Promise.all([
    supabase
      .from('exhibition_vendors')
      .select('id, name, code, phone, address, banner_url, stand_number, hall, opening_hours, whatsapp, min_order, pickup_instructions')
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
      .select('id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, qty, image_url, status, vendors:vendor_id(name, code), categories:category_id(name)')
      .eq('cycle_id', cycleId)
      .eq('status', 'active')
      .order('name'),
  ])

  const data = { vendorsRes, categoriesRes, productsRes }
  if (!productsRes.error) {
    coreCache.set(cycleId, { at: Date.now(), data })
    if (coreCache.size > 50) coreCache.delete(coreCache.keys().next().value)
  }
  return data
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

    // The season is org-wide (one cycle for every branch, like Food/RAM).
    // The branch decides which market's goods the member browses and collects.
    const branchCodeFilter = String(searchParams.get('branch_code') || '').trim().toUpperCase()

    // ── The active season ────────────────────────────────────────
    // "Live" = status 'active' AND its date window is open (auto-closes when
    // ends_at passes, even without admin action).
    const { data: activeRows } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, starts_at, ends_at, loan_interest_rate_pct')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(2)

    // Fallback to the latest cycle (any status) so the UI can still show
    // draft/closed season info (e.g. "opens on …").
    const { data: latest } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status, starts_at, ends_at, loan_interest_rate_pct')
      .order('created_at', { ascending: false })
      .maybeSingle()

    const now = Date.now()
    const live = (activeRows || []).find((c) => {
      if (c.starts_at && new Date(c.starts_at).getTime() > now) return false
      if (c.ends_at && new Date(c.ends_at).getTime() <= now) return false
      return true
    })

    const cycle = live || latest
    if (!cycle) {
      return NextResponse.json({ ok: true, open: false, branch: '', availableBranches: [] })
    }

    const cycleOpen = !!live
    const cycleId = Number(cycle.id)

    const { vendorsRes, categoriesRes, productsRes } = await loadCatalogCore(supabase, cycleId)

    if (productsRes.error && isMissingTable(productsRes.error, 'exhibition')) {
      return NextResponse.json(
        { ok: false, error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' },
        { status: 500 }
      )
    }
    if (productsRes.error) return NextResponse.json({ ok: false, error: productsRes.error.message }, { status: 500 })

    // Only the selected branch's market is browsable. Every branch has its own
    // vendors and stock, but they all belong to the one season.
    const allProducts = productsRes.data || []
    const branchIdsInCycle = [...new Set(allProducts.map((p) => Number(p.branch_id)).filter((n) => Number.isFinite(n) && n > 0))]
    const { data: branchRows } = branchIdsInCycle.length
      ? await supabase.from('branches').select('id, code, name').in('id', branchIdsInCycle)
      : { data: [] }
    const branchById = new Map((branchRows || []).map((b) => [Number(b.id), b]))
    const availableBranches = branchIdsInCycle
      .map((bid) => branchById.get(bid))
      .filter(Boolean)
      .map((b) => ({ code: b.code, name: b.name || b.code, cycleName: cycle.name || '' }))

    const requestedBranch = branchCodeFilter
      ? (branchRows || []).find((b) => String(b.code || '').toUpperCase() === branchCodeFilter)
      : null
    // The location that actually has stock wins: the requested branch when it
    // sells something, else the member's own branch, else any stocked branch.
    // Falling back to the member's branch even when it stocks nothing is what
    // left /exhibition/all showing an empty market.
    const stocked = (id) => {
      const n = Number(id)
      return n > 0 && allProducts.some((p) => Number(p.branch_id) === n)
    }
    const selectedBranchId =
      [requestedBranch?.id, member.branch_id, ...branchIdsInCycle].map(Number).find(stocked) || 0
    const selectedBranch = branchById.get(selectedBranchId) || null
    const products = allProducts.filter((p) => Number(p.branch_id) === selectedBranchId)
    const productIds = products.map((p) => p.id)

    // Optional services sold with a product (installation, assembly …). They
    // carry no stock of their own, so they ride along with the product line
    // rather than appearing as separate shelf items.
    const addonsByProduct = new Map()
    if (productIds.length) {
      const { data: addonRows } = await supabase
        .from('exhibition_product_addons')
        .select('id, product_id, name, price, unit')
        .in('product_id', productIds)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      for (const a of addonRows || []) {
        const pid = Number(a.product_id)
        if (!addonsByProduct.has(pid)) addonsByProduct.set(pid, [])
        addonsByProduct.get(pid).push({
          id: Number(a.id),
          name: a.name || 'Service',
          price: Number(a.price || 0),
          unit: a.unit || 'service',
        })
      }
    }

    // Units other members are holding in their carts are not for sale. The
    // catalogue advertises what is actually left, not the raw shelf count.
    const { data: holdRows } = productIds.length
      ? await supabase
          .from('exhibition_stock_holds')
          .select('product_id, qty')
          .in('product_id', productIds)
          .gt('expires_at', new Date().toISOString())
          .neq('member_id', memberId)
      : { data: [] }
    const heldByOthers = new Map()
    for (const h of holdRows || []) {
      const pid = Number(h.product_id)
      heldByOthers.set(pid, (heldByOthers.get(pid) || 0) + Number(h.qty || 0))
    }

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
      const base = Number(p.vendor_price || 0)
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
        qty: p.qty === null ? null : Math.max(0, Number(p.qty) - (heldByOthers.get(Number(p.id)) || 0)),
        image_url: p.image_url || '',
        addons: addonsByProduct.get(Number(p.id)) || [],
      }
    })

    // Optional window for very large catalogues. The default stays the full
    // list so existing clients keep working unchanged.
    const limitParam = Math.trunc(Number(searchParams.get('limit') || 0))
    const offsetParam = Math.max(0, Math.trunc(Number(searchParams.get('offset') || 0)))
    const total = catalogProducts.length
    const paged = limitParam > 0
      ? catalogProducts.slice(offsetParam, offsetParam + limitParam)
      : catalogProducts

    return NextResponse.json({
      ok: true,
      open: cycleOpen,
      total,
      branch: selectedBranch?.name || '',
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
        banner_url: v.banner_url || '',
        stand_number: v.stand_number || '',
        hall: v.hall || '',
        opening_hours: v.opening_hours || '',
        whatsapp: v.whatsapp || '',
        min_order: Number(v.min_order || 0),
        pickup_instructions: v.pickup_instructions || '',
      })),
      categories: (categoriesRes.data || []).map((c) => ({ id: Number(c.id), name: c.name || '' })),
      products: paged,
      availableBranches,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load exhibition' }, { status: 500 })
  }
}
