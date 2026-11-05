// app/exhibition/page.jsx
// Member-facing Coop Exhibition home, built to the approved mockup:
//
//   1. pickup location, front and centre (stands and stock belong to it)
//   2. search with a scope (all / stands / products)
//   3. Featured stands — an auto-sliding rail through every stand
//   4. category chips
//   5. a short "Popular at this location" product preview (8 items), with
//      "See all" going to the full catalogue
//
// The stands remain the point of the page: products are a preview, not an
// endless feed. "All products" / "See all" open /exhibition/all.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Search, Store, Tag, X } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import ExhibitionCycleHint from '../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../components/ContinueShoppingBanner'
import ExhibitionHubs from '../components/ExhibitionHubs'
import ExhibitionProductCard from '../components/ExhibitionProductCard'
import CartStickyBar from '../components/CartStickyBar'
import useExhibitionCatalog from '../hooks/useExhibitionCatalog'
import useExhibitionCart from '../hooks/useExhibitionCart'
import ModuleClosedPanel from '../components/ModuleClosedPanel'
import Skeleton from '../components/ui/Skeleton'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'exhibitionDeliveryBranch'
const PREVIEW_COUNT = 8

function ExhibitionShopContent() {
  const router = useRouter()
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()

  // Delivery location — persisted so the cart, stand pages and re-visits agree.
  const [selectedBranch, setSelectedBranch] = useState(() => {
    try { return localStorage.getItem(`${STORAGE_KEY}_${memberId}`) || '' } catch { return '' }
  })
  const { catalog, error, loading } = useExhibitionCatalog(selectedBranch)
  const { addToCart, qtyOf, cartCount, cartTotal } = useExhibitionCart()

  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all') // all | stands | products
  const [categoryId, setCategoryId] = useState(null)

  const availableBranches = useMemo(() => catalog?.availableBranches || [], [catalog])

  // One branch open → pick it once so the member is never asked.
  useEffect(() => {
    if (availableBranches.length === 1 && !selectedBranch) {
      const code = availableBranches[0].code
      setSelectedBranch(code)
      try { localStorage.setItem(`${STORAGE_KEY}_${memberId}`, code) } catch {}
    }
  }, [availableBranches, selectedBranch, memberId])

  const handleBranchChange = (code) => {
    setSelectedBranch(code)
    try { localStorage.setItem(`${STORAGE_KEY}_${memberId}`, code) } catch {}
  }

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])
  const categories = useMemo(() => catalog?.categories || [], [catalog])

  const vendorCounts = useMemo(() => {
    const map = {}
    for (const p of products) map[p.vendor_id] = (map[p.vendor_id] || 0) + 1
    return map
  }, [products])

  // Only stands that actually have something to sell belong in the rail.
  const standsWithProducts = useMemo(() => {
    const ids = new Set(products.map((p) => p.vendor_id))
    return vendors.filter((v) => ids.has(v.id))
  }, [vendors, products])

  const q = query.trim().toLowerCase()

  const stands = useMemo(() => {
    if (!q) return standsWithProducts
    return standsWithProducts.filter(
      (v) =>
        String(v.name || '').toLowerCase().includes(q) ||
        String(v.address || '').toLowerCase().includes(q)
    )
  }, [standsWithProducts, q])

  const matchedProducts = useMemo(() => {
    return products.filter((p) => {
      if (categoryId && p.category_id !== categoryId) return false
      if (q) {
        const name = String(p.name || '').toLowerCase()
        const vendor = String(p.vendor_name || '').toLowerCase()
        if (!name.includes(q) && !vendor.includes(q)) return false
      }
      return true
    })
  }, [products, categoryId, q])

  const categoriesWithProducts = useMemo(() => {
    const used = new Set(products.map((p) => p.category_id).filter(Boolean))
    return categories.filter((c) => used.has(c.id))
  }, [categories, products])

  const preview = matchedProducts.slice(0, PREVIEW_COUNT)
  const showStands = scope !== 'products'
  const showProducts = scope !== 'stands'
  // Show the branch the catalogue actually served, even before the member has
  // picked one, so the chip never reads empty while the rail is already loaded.
  const servedBranchCode =
    availableBranches.find((b) => b.code === selectedBranch)?.code ||
    availableBranches.find((b) => b && b.name === catalog?.branch)?.code ||
    ''
  const branchName =
    availableBranches.find((b) => b.code === servedBranchCode)?.name || catalog?.branch || ''
  const searching = !!q || !!categoryId

  // A search that finds nothing is the market telling us what is missing.
  // Logged once per settled query, and it can never block the page.
  useEffect(() => {
    if (!q || loading) return undefined
    if (stands.length > 0 || matchedProducts.length > 0) return undefined
    const t = setTimeout(() => {
      fetch('/api/exhibition/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, type: 'search', query: q, results: 0 }),
      }).catch(() => {})
    }, 900)
    return () => clearTimeout(t)
  }, [q, loading, stands.length, matchedProducts.length, memberId])

  // ── Closed state ─────────────────────────────────────────────────
  if (!loading && catalog && !catalog.open) {
    return (
      <ProtectedRoute allowedRoles={['member']}>
        <div className="min-h-screen bg-canvas">
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
            <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
          </div>
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
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="min-h-screen bg-canvas">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative p-fluid pb-28 sm:pb-32 md:pb-36 max-w-7xl mx-auto">
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
                  : `${standsWithProducts.length} stand${standsWithProducts.length === 1 ? '' : 's'} · ${products.length} product${products.length === 1 ? '' : 's'}${catalog?.cycle?.ends_at ? ` · ends ${new Date(catalog.cycle.ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}`}
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
                  value={servedBranchCode}
                  onChange={(e) => handleBranchChange(e.target.value)}
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

          {/* 2 — Search with a scope */}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={scope === 'stands' ? 'Search stands…' : scope === 'products' ? 'Search products…' : 'Search products or stands…'}
                aria-label="Search the exhibition"
                className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-9 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
              />
              {!!query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-subtle hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              aria-label="Search scope"
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-medium text-fg focus:border-brand focus:outline-none sm:w-40"
            >
              <option value="all">All stands</option>
              <option value="stands">Stands only</option>
              <option value="products">Products only</option>
            </select>
          </div>

          {/* 3 — Featured stands (sliding rail) */}
          {loading ? (
            <div className="mb-6 flex gap-3 overflow-hidden">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[104px] w-[calc(50%-6px)] shrink-0 rounded-2xl sm:w-[calc(33.333%-8px)] md:w-[calc(25%-9px)] lg:w-[calc(20%-9.6px)] xl:w-[calc(16.666%-10px)]" />
              ))}
            </div>
          ) : showStands ? (
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
                  <p className="text-sm font-medium text-fg">No stands match “{query}”</p>
                  <p className="mt-0.5 text-chips text-muted">Try another name, or clear the search.</p>
                </div>
              ) : (
                <ExhibitionHubs vendors={stands} vendorCounts={vendorCounts} />
              )}
            </div>
          ) : null}

          {/* 4 — Categories */}
          {showProducts && categoriesWithProducts.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-chips font-medium uppercase tracking-wider text-muted">
                <Tag className="h-3 w-3" strokeWidth={2.2} />
                Categories
              </span>
              <button
                type="button"
                onClick={() => setCategoryId(null)}
                className={[
                  'rounded-full border px-3 py-1.5 text-chips font-medium transition-colors duration-150',
                  categoryId === null ? 'border-brand bg-brand text-on-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
                ].join(' ')}
              >
                All
              </button>
              {categoriesWithProducts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  className={[
                    'rounded-full border px-3 py-1.5 text-chips font-medium transition-colors duration-150',
                    categoryId === c.id ? 'border-brand bg-brand text-on-accent' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
                  ].join(' ')}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {/* 5 — Popular at this location (preview only) */}
          {showProducts && !loading && preview.length > 0 && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-chips font-medium uppercase tracking-wider text-muted">
                  {searching ? `${matchedProducts.length} match${matchedProducts.length === 1 ? '' : 'es'}` : 'Popular at this location'}
                </span>
                {!searching && (
                  <button
                    type="button"
                    onClick={() => router.push('/exhibition/all')}
                    className="text-chips font-semibold text-brand hover:underline"
                  >
                    See all {products.length} →
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7">
                {preview.map((p) => (
                  <ExhibitionProductCard
                    key={p.id}
                    p={p}
                    qty={qtyOf(p.id)}
                    onAdd={(d) => addToCart(p, d)}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && showProducts && preview.length === 0 && searching && (
            <div className="rounded-2xl border border-line-subtle bg-subtle/40 px-4 py-6 text-center">
              <p className="text-sm font-medium text-fg">No products match your search</p>
              <p className="mt-0.5 text-chips text-muted">Try clearing the search or picking another category.</p>
            </div>
          )}
        </div>

        <CartStickyBar
          count={cartCount}
          total={cartTotal}
          subtitle="Negotiated prices applied where they exist"
          onGoToCart={() => router.push('/exhibition/cart')}
        />
      </div>
    </ProtectedRoute>
  )
}

export default function ExhibitionPage() {
  return <ExhibitionShopContent />
}
