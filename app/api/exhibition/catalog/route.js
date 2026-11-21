// app/api/exhibition/catalog/route.js
// Member-facing catalog for the Coop Exhibition shop.
//   GET /api/exhibition/catalog — the signed-in member's catalog (an admin may
//   pass ?member_id= for another member). The member comes from the session.
// Returns the exhibition catalog: active cycle, vendors, categories and
// active products.  The exhibition is GLOBALLY visible — any member can
// browse and shop from any open exhibition.  The cycle's branch is the
// delivery/pickup location, not a visibility filter.
// Each product carries:
//   - final_price  = vendor_price (the list price, struck through on sale)
//   - price        = the price THIS member pays (approved discount applied)
//   - discount_pct = the product's approved percentage discount (0 when none)
//   - negotiated   = true when a per-member price overrides the catalog
// When no cycle is active, returns { ok: true, open: false } so the shop
// can show the shared closed-module panel.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { resolveMemberScope } from '@/lib/memberScope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

// ── Cycle catalogue ──────────────────────────────────────────────────
// Why this is not cached: on Vercel every server instance has its own memory,
// so an approval handled by one instance cannot clear another's cache and
// freshly approved products stay hidden for up to the TTL. Correctness wins —
// three indexed queries per request is the honest price of an always-current
// shop.

const PRODUCT_COLS =
  'id, cycle_id, vendor_id, branch_id, category_id, name, sku, unit, vendor_price, qty, image_url, status, vendors:vendor_id(name, code), categories:category_id(name)'

// description and discount_pct arrive with their own migrations. Try the full
// read first, then drop whichever column the database has not got yet, so a
// deploy ahead of the SQL cannot empty the shop for every member.
//
// PostgREST caps a response at its max-rows setting (1,000 by default), so the
// read pages through 1,000-row windows: a market with more than 1,000 approved
// products must show all of them, not stop at the cap.
const PAGE = 1000

async function loadProducts(supabase, cycleId) {
  let lastError = null
  for (const extra of [', description, discount_pct', ', description', '']) {
    const rows = []
    let failed = null
    for (let from = 0; ; from += PAGE) {
      const res = await supabase
        .from('exhibition_products')
        .select(PRODUCT_COLS + extra)
        .eq('cycle_id', cycleId)
        .eq('status', 'active')
        .eq('approval_status', 'approved')
        .order('name')
        .order('id')
        .range(from, from + PAGE - 1)
      if (res.error) {
        failed = res.error
        break
      }
      rows.push(...(res.data || []))
      if ((res.data || []).length < PAGE) break
    }
    if (!failed) return { data: rows, error: null }
    lastError = failed
    if (!/description|discount_pct|schema cache/i.test(String(failed.message || ''))) break
  }
  return { data: null, error: lastError }
}

async function loadCatalogCore(supabase, cycleId) {
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
    loadProducts(supabase, cycleId),
  ])

  return { vendorsRes, categoriesRes, productsRes }
}


export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const scope = await resolveMemberScope(req, searchParams.get('member_id'), { allow: ['member', 'admin'] })
    if (!scope.ok) return scope.response
    const memberId = scope.memberId
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

    // A branch is only offered when it actually has approved goods. A member
    // whose own branch (or a stale saved pickup location) sells nothing here
    // must still see the stands that do, instead of an empty catalogue.
    const requestedBranch = branchCodeFilter
      ? (branchRows || []).find((b) => String(b.code || '').toUpperCase() === branchCodeFilter)
      : null
    const memberBranchId = Number(member.branch_id) || 0
    const selectedBranchId =
      Number(requestedBranch?.id) ||
      (branchIdsInCycle.includes(memberBranchId) ? memberBranchId : 0) ||
      branchIdsInCycle[0] ||
      0
    const selectedBranch = branchById.get(selectedBranchId) || null
    const products = allProducts.filter((p) => Number(p.branch_id) === selectedBranchId)
    const productIds = products.map((p) => p.id)

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

    const catalogProducts = products.map((p) => {
      const listPrice = Number(p.vendor_price || 0)
      const discountPct = Math.min(90, Math.max(0, Math.trunc(Number(p.discount_pct || 0))))
      const price = discountPct > 0 ? Math.max(0, Math.round((listPrice * (100 - discountPct)) / 100)) : listPrice
      return {
        id: Number(p.id),
        vendor_id: Number(p.vendor_id),
        vendor_name: p.vendors?.name || '',
        category_id: p.category_id ? Number(p.category_id) : null,
        category_name: p.categories?.name || '',
        name: p.name,
        description: p.description || '',
        sku: p.sku,
        unit: p.unit,
        price,
        final_price: listPrice,
        discount_pct: discountPct,
        negotiated: false,
        negotiated_note: '',
        qty: p.qty === null ? null : Math.max(0, Number(p.qty) - (heldByOthers.get(Number(p.id)) || 0)),
        image_url: p.image_url || '',
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
