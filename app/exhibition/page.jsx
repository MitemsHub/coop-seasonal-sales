// app/exhibition/page.jsx
// Member-facing Coop Exhibition shop. Browse the branch's exhibition by
// category and vendor hub (auto-rotating hub slideshow), search, and add
// products to the exhibition cart. The shopping surface itself (search,
// filters, product grid, sticky cart bar) lives in ExhibitionCatalog so the
// full catalog page and vendor hub share the exact same buying logic.
'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Store } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import ExhibitionCycleHint from '../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../components/ContinueShoppingBanner'
import ExhibitionHubs from '../components/ExhibitionHubs'
import ExhibitionCatalog from '../components/ExhibitionCatalog'
import useExhibitionCatalog from '../hooks/useExhibitionCatalog'
import ModuleClosedPanel from '../components/ModuleClosedPanel'

function ExhibitionShopContent() {
  const router = useRouter()
  const { catalog, error, loading } = useExhibitionCatalog()

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])

  // Vendors that actually have products, plus per-stand product counts — the
  // hub slideshow's feed.
  const vendorsWithProducts = useMemo(() => {
    const ids = new Set(products.map((p) => p.vendor_id))
    return vendors.filter((v) => ids.has(v.id))
  }, [vendors, products])
  const vendorCounts = useMemo(() => {
    const map = {}
    for (const p of products) map[p.vendor_id] = (map[p.vendor_id] || 0) + 1
    return map
  }, [products])

  // ── Closed state (only when the API explicitly says the market is closed) ──
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
        {/* Ambient canvas glows (Sakani) */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative p-fluid pb-28 sm:pb-32 md:pb-36 max-w-7xl mx-auto">
          {/* Continue-shopping banner — surfaces food/ram carts here; the
              exhibition cart is already covered by the sticky cart bar. */}
          <ContinueShoppingBanner excludeModules={['exhibition']} className="mb-fluid-lg" />

          {/* Hero */}
          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
                <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
                Coop Exhibition
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {catalog?.cycle?.name ? catalog.cycle.name : 'The Exhibition Shop'}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted">
                {catalog?.branch
                  ? `Seasonal market at ${catalog.branch}. Browse vendor stands, shop quality goods, pick up in person.`
                  : 'Browse vendor stands and shop quality goods.'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-chips font-medium text-muted sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-success-fg" />
                {catalog?.open ? 'Market open' : 'Market closed'}
              </span>
            </div>
          </div>

          {/* Shared shopping surface — search, filters, hub slideshow slot,
              product grid and sticky cart bar. */}
          <ExhibitionCatalog
            catalog={catalog}
            loading={loading}
            error={error}
            beforeGrid={
              !loading && vendorsWithProducts.length > 0 ? (
                <ExhibitionHubs vendors={vendorsWithProducts} vendorCounts={vendorCounts} />
              ) : null
            }
          />
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function ExhibitionPage() {
  return <ExhibitionShopContent />
}
