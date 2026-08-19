// app/exhibition/all/page.jsx
// "View all" — the full exhibition catalog as its own page. Every stand's
// products appear together (paginated so 100+ items stay browsable) with the
// same search, category/vendor filters and add-to-cart controls as the shop,
// so normal buying happens right here without jumping between hubs.
'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { PackageSearch, Store } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import ExhibitionCycleHint from '../../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../../components/ContinueShoppingBanner'
import ExhibitionCatalog from '../../components/ExhibitionCatalog'
import useExhibitionCatalog from '../../hooks/useExhibitionCatalog'
import ModuleClosedPanel from '../../components/ModuleClosedPanel'
import Skeleton from '../../components/ui/Skeleton'

const CATALOG_PAGE_SIZE = 24

function AllProductsContent() {
  const router = useRouter()
  const { catalog, error, loading } = useExhibitionCatalog()

  const productCount = useMemo(() => catalog?.products?.length || 0, [catalog])

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

          {/* Header */}
          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
                <PackageSearch className="h-3.5 w-3.5" strokeWidth={2.2} />
                Coop Exhibition
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {loading ? 'All vendor products' : `All products · ${catalog?.cycle?.name || 'this season'}`}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Every stand in your branch&apos;s exhibition, in one place. Filter, add to cart and check out from here.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {loading ? (
                <Skeleton className="h-8 w-24 rounded-full" />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-chips font-medium text-muted">
                  <Store className="h-3.5 w-3.5" />
                  {productCount.toLocaleString()} product{productCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>

          {/* Shared shopping surface — search, filters, paginated grid, sticky bar */}
          <ExhibitionCatalog
            catalog={catalog}
            loading={loading}
            error={error}
            pageSize={CATALOG_PAGE_SIZE}
          />
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function AllProductsPage() {
  return <AllProductsContent />
}
