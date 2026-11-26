// app/exhibition/stands/page.jsx
// "View all" for Featured stands — every stand in the member's delivery
// location, as a browsable grid. Each card opens that stand's page, where its
// approved products live. The card is the same StandCard the shop's featured
// rail uses, so a stand looks identical wherever a member meets it, and the
// thumbnails are a preview only — the stand page is where the products are.
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Search, Store, X } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import ExhibitionCycleHint from '../../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../../components/ContinueShoppingBanner'
import BackLink from '../../components/BackLink'
import AmbientBackdrop from '../../components/AmbientBackdrop'
import useExhibitionBranch from '../../hooks/useExhibitionBranch'
import ModuleClosedPanel from '../../components/ModuleClosedPanel'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'
import StandCard from '../../components/StandCard'
import { countVendorProducts, searchStands, standsWithProducts } from '../../../lib/exhibitionStands'
import { shelfSummaryForVendor } from '../../../lib/exhibitionShelf'

function AllStandsContent() {
  const router = useRouter()
  const { catalog, error, loading, availableBranches, branchCode, branchName, changeBranch } = useExhibitionBranch()
  const [query, setQuery] = useState('')

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])

  // Each stand's own products, for the thumbnail strip on its card.
  const productsByVendor = useMemo(() => {
    const map = {}
    for (const p of products) {
      if (!map[p.vendor_id]) map[p.vendor_id] = []
      map[p.vendor_id].push(p)
    }
    return map
  }, [products])

  const vendorCounts = useMemo(() => countVendorProducts(products), [products])
  const sellableStands = useMemo(() => standsWithProducts(vendors, products), [vendors, products])
  const stands = useMemo(() => searchStands(sellableStands, query, products), [sellableStands, query, products])

  // The shelves each stand's products actually land on, best first, so a name
  // like "OG WINNERS" still tells a member what the stand sells.
  const shelfLabelsByVendor = useMemo(() => {
    const byVendor = new Map()
    for (const p of products) {
      const id = Number(p.vendor_id)
      if (!byVendor.has(id)) byVendor.set(id, [])
      byVendor.get(id).push(p)
    }
    const map = {}
    for (const v of vendors) {
      map[v.id] = shelfSummaryForVendor(v, byVendor.get(Number(v.id)) || []).map((s) => s.label)
    }
    return map
  }, [vendors, products])

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

  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="relative isolate min-h-screen bg-canvas">
        <AmbientBackdrop />

        <div className="relative z-10 p-fluid pb-28 sm:pb-32 md:pb-36 max-w-7xl mx-auto">
          <BackLink href="/exhibition" label="Back to shop" className="mb-3" />

          <ContinueShoppingBanner excludeModules={['exhibition']} className="mb-fluid-lg" />

          {/* Header */}
          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
                <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
                Coop Exhibition
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {loading ? 'All stands' : `All stands · ${sellableStands.length}`}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Every stand at your pickup location. Open a stand to see all of its products.
              </p>
            </div>

            {availableBranches.length > 0 && (
              <select
                value={branchCode}
                onChange={(e) => changeBranch(e.target.value)}
                aria-label="Select your Delivery Location"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-fg focus:border-brand focus:outline-none sm:w-64"
              >
                {availableBranches.map((b) => (
                  <option key={b.code} value={b.code}>{b.name}</option>
                ))}
              </select>
            )}
          </div>

          {!!error && (
            <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</div>
          )}

          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stands…"
                aria-label="Search stands"
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
            {branchName && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-chips text-muted">
                <MapPin className="h-3 w-3" strokeWidth={2} />
                Pickup: <span className="font-semibold text-brand">{branchName}</span>
              </p>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                                  <Skeleton key={i} className="h-[248px] rounded-2xl" />
              ))}
            </div>
          ) : stands.length === 0 ? (
            <EmptyState
              icon={Store}
              title={query ? `No stands match “${query}”` : 'No stands at this location yet'}
              description={query ? 'Try another name, or clear the search.' : 'Stands appear here once they list products.'}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {stands.map((v, i) => (
                <StandCard
                  key={v.id}
                  v={v}
                  index={i}
                  count={vendorCounts[v.id] || 0}
                  products={productsByVendor[v.id] || []}
                  shelfLabels={shelfLabelsByVendor[v.id]}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function AllStandsPage() {
  return <AllStandsContent />
}
