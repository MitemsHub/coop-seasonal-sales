// app/exhibition/page.jsx
// Member-facing Coop Exhibition home.
//
//   1. pickup location, front and centre (stands and stock belong to it)
//   2. the sticky discovery bar — search (products and stands), category pills,
//      in-stock / on-offer / price refinements and sort
//   3. Featured stands — an auto-sliding rail of shopfront cards
//   4. the branch's whole shelf, revealed in place a screenful at a time
//      (16 per step), with "View all" at the bottom opening the full catalogue
//
// The stands remain the point of the page. Category pills come from what each
// vendor declared it sells (lib/exhibitionVendorCategories.js, harmonised by
// lib/exhibitionShelf.js), not from the products' own category field — that
// field is mostly empty and, worse, let a product's name decide its shelf
// ("Turkey gown" under Meat & Fish).
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Store } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import ExhibitionCycleHint from '../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../components/ContinueShoppingBanner'
import ExhibitionHubs from '../components/ExhibitionHubs'
import ExhibitionFilterBar from '../components/ExhibitionFilterBar'
import ExhibitionProductCard from '../components/ExhibitionProductCard'
import ExhibitionProductSkeleton from '../components/ExhibitionProductSkeleton'
import CartStickyBar from '../components/CartStickyBar'
import useExhibitionBranch from '../hooks/useExhibitionBranch'
import useExhibitionCart from '../hooks/useExhibitionCart'
import useExhibitionFilters from '../hooks/useExhibitionFilters'
import ModuleClosedPanel from '../components/ModuleClosedPanel'
import AmbientBackdrop from '../components/AmbientBackdrop'
import Skeleton from '../components/ui/Skeleton'
import { countVendorProducts, searchStands, standsWithProducts } from '../../lib/exhibitionStands'

// The shop used to stop at eight products and send members to "View all" for
// the rest, which read as a half-empty shop when a branch has 100+ items. It
// now reveals the whole shelf in place, a screenful at a time.
const PRODUCT_STEP = 16

function ExhibitionShopContent() {
  const router = useRouter()
  // Delivery location — persisted so the cart, stand pages and re-visits agree.
  const { catalog, error, loading, availableBranches, branchCode, branchName, changeBranch } = useExhibitionBranch()
  const { addToCart, qtyOf, cartCount, cartTotal } = useExhibitionCart()

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])

  const filters = useExhibitionFilters(products, vendors)
  const { filtered, q, isFiltering, signature, activeShelf } = filters

  const [visibleCount, setVisibleCount] = useState(PRODUCT_STEP)

  const vendorCounts = useMemo(() => countVendorProducts(products), [products])

  // The stand cards show a strip of what is actually on each stand, so the rail
  // reads like a market rather than a directory of names.
  const productsByVendor = useMemo(() => {
    const map = {}
    for (const p of products) {
      if (!map[p.vendor_id]) map[p.vendor_id] = []
      map[p.vendor_id].push(p)
    }
    return map
  }, [products])

  // Only stands that actually have something to sell belong in the rail.
  const sellableStands = useMemo(() => standsWithProducts(vendors, products), [vendors, products])

  // One search serves both halves of the page: typing "rice" narrows the stands
  // to those selling it and the shelf to the rice itself.
  const stands = useMemo(() => searchStands(sellableStands, q), [sellableStands, q])

  // Any change to the query starts the shelf over from the top.
  useEffect(() => {
    setVisibleCount(PRODUCT_STEP)
  }, [signature])

  const visible = filtered.slice(0, visibleCount)
  const remaining = filtered.length - visible.length

  // ── Closed state ─────────────────────────────────────────────────
  if (!loading && catalog && !catalog.open) {
    return (
      <ProtectedRoute allowedRoles={['member']}>
        <div className="relative isolate min-h-screen bg-canvas">
          <AmbientBackdrop />
          <div className="relative z-10">
            <ModuleClosedPanel
              module="exhibition"
              variant="inline"
              hint={
                catalog?.cycle?.starts_at || catalog?.cycle?.ends_at ? (
                  <ExhibitionCycleHint cycle={catalog.cycle} />
                ) : undefined
              }
              onViewOrders={() => router.push('/orders')}
              onBack={() => router.push('/my-coop')}
            />
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  const heading = activeShelf
    ? `${activeShelf.label} · ${filtered.length}`
    : isFiltering
      ? `${filtered.length} product${filtered.length === 1 ? '' : 's'} match`
      : `Products at this location · ${filtered.length}`

  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="relative isolate min-h-screen bg-canvas">
        <AmbientBackdrop />

        <div className="relative z-10 p-fluid pb-28 sm:pb-32 md:pb-36 max-w-7xl mx-auto">
          <ContinueShoppingBanner excludeModules={['exhibition']} className="mb-fluid-lg" />

          {/* Hero */}
          <div className="mb-fluid-md flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
                <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
                Coop Exhibition
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {catalog?.cycle?.name ? catalog.cycle.name : 'The Exhibition Shop'}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {loading
                  ? 'Loading this season…'
                  : `${sellableStands.length} stand${sellableStands.length === 1 ? '' : 's'} · ${products.length} product${products.length === 1 ? '' : 's'}${catalog?.cycle?.ends_at ? ` · ends ${new Date(catalog.cycle.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}`}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {branchName && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-chips font-medium text-brand">
                  <MapPin className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Pickup: <span className="font-semibold">{branchName}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-chips font-medium text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-success-fg" />
                {loading ? 'Checking…' : catalog?.open ? 'Market open' : 'Market closed'}
              </span>
            </div>
          </div>

          {!!error && (
            <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</div>
          )}

          {/* 1 — Delivery location */}
          {availableBranches.length > 0 && (
            <div className="mb-4 rounded-2xl border border-line bg-surface p-3 sm:p-4">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent">
                    <MapPin className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-fg">Select your Delivery Location</h2>
                    <p className="truncate text-chips text-muted">
                      {branchName ? `${branchName} · stands and pickup shown for this location` : 'Stands and pickup shown for this location'}
                    </p>
                  </div>
                </div>
                <select
                  id="delivery-location"
                  value={branchCode}
                  onChange={(e) => changeBranch(e.target.value)}
                  aria-label="Select your Delivery Location"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg focus:border-brand focus:outline-none sm:w-64"
                >
                  {availableBranches.map((b) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* 2 — Sticky discovery bar */}
          <ExhibitionFilterBar filters={filters} className="mb-4" />

          {loading ? (
            <>
              <div className="mb-6 flex gap-3 overflow-hidden">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[148px] w-[calc(50%-6px)] shrink-0 rounded-2xl sm:w-[calc(33.333%-8px)] lg:w-[calc(25%-9px)] xl:w-[calc(20%-9.6px)]" />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7">
                {Array.from({ length: 12 }).map((_, i) => (
                  <ExhibitionProductSkeleton key={i} />
                ))}
              </div>
            </>
          ) : (
            <>
              {/* 3 — Featured stands (sliding rail) */}
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-chips font-medium uppercase tracking-wider text-muted">
                    <Store className="h-3 w-3" strokeWidth={2.2} />
                    Featured stands
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-chips text-muted">
                      {stands.length.toLocaleString()} stand{stands.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={() => router.push('/exhibition/stands')}
                      className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-chips font-semibold text-fg transition-colors duration-200 ease-sakani hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      View all
                    </button>
                  </span>
                </div>

                {stands.length === 0 ? (
                  <div className="rounded-2xl border border-line-subtle bg-subtle/40 px-4 py-6 text-center">
                    <p className="text-sm font-medium text-fg">No stands match “{filters.search.trim()}”</p>
                    <p className="mt-0.5 text-chips text-muted">Try another name, or clear the search.</p>
                  </div>
                ) : (
                  <ExhibitionHubs
                    vendors={stands}
                    vendorCounts={vendorCounts}
                    productsByVendor={productsByVendor}
                  />
                )}
              </div>

              {/* 4 — Products at this location — the whole shelf, revealed in place */}
              {visible.length > 0 && (
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-chips font-medium uppercase tracking-wider text-muted">
                      {heading}
                    </span>
                    {!isFiltering && (
                      <button
                        type="button"
                        onClick={() => router.push('/exhibition/all')}
                        className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-chips font-semibold text-fg transition-colors duration-200 ease-sakani hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        View all
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7">
                    {visible.map((p) => (
                      <ExhibitionProductCard
                        key={p.id}
                        p={p}
                        qty={qtyOf(p.id)}
                        onAdd={(d) => addToCart(p, d)}
                      />
                    ))}
                  </div>

                  <div className="mt-4 flex flex-col items-center gap-2">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {remaining > 0 && (
                        <button
                          type="button"
                          onClick={() => setVisibleCount((c) => c + PRODUCT_STEP)}
                          className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-4 text-chips font-semibold text-fg transition-colors duration-200 ease-sakani hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        >
                          Show {Math.min(PRODUCT_STEP, remaining)} more product{Math.min(PRODUCT_STEP, remaining) === 1 ? '' : 's'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => router.push('/exhibition/all')}
                        className="inline-flex h-9 items-center rounded-lg border border-brand bg-brand px-4 text-chips font-semibold text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        View all {filtered.length} product{filtered.length === 1 ? '' : 's'}
                      </button>
                    </div>
                    <span className="text-chips text-muted tabular-nums">
                      Showing {visible.length} of {filtered.length}
                    </span>
                  </div>
                </div>
              )}

              {visible.length === 0 && isFiltering && (
                <div className="rounded-2xl border border-line-subtle bg-subtle/40 px-4 py-6 text-center">
                  <p className="text-sm font-medium text-fg">No products match your filters</p>
                  <p className="mt-0.5 text-chips text-muted">Try another shelf, or clear the search.</p>
                </div>
              )}
            </>
          )}
        </div>

        <CartStickyBar
          count={cartCount}
          total={cartTotal}
          onGoToCart={() => router.push('/exhibition/cart')}
        />
      </div>
    </ProtectedRoute>
  )
}

export default function ExhibitionPage() {
  return <ExhibitionShopContent />
}
