// app/exhibition/stands/page.jsx
// "View all" for Featured stands — every stand in the member's delivery
// location, as a browsable grid. Each card opens that stand's page, where its
// approved products live. Products are deliberately not listed here; this is
// the stands directory, not another catalogue.
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, MapPin, Search, Store, X } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import ExhibitionCycleHint from '../../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../../components/ContinueShoppingBanner'
import BackLink from '../../components/BackLink'
import AmbientBackdrop from '../../components/AmbientBackdrop'
import useExhibitionBranch from '../../hooks/useExhibitionBranch'
import ModuleClosedPanel from '../../components/ModuleClosedPanel'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'
import { countVendorProducts, initials, searchStands, standsWithProducts } from '../../../lib/exhibitionStands'
import { shelfSummaryForVendor } from '../../../lib/exhibitionShelf'

function StandTile({ v, count, shelfLabels = [] }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.push(`/exhibition/vendor/${v.id}`)}
      aria-label={`Open ${v.name} stand`}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface p-4 text-left transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span className="flex w-full min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-xs font-bold text-accent-fg transition-colors duration-200 ease-sakani group-hover:bg-accent/25">
          {initials(v.name)}
        </span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-subtext transition-transform duration-200 ease-sakani group-hover:translate-x-0.5 group-hover:text-accent" />
      </span>
      <span className="mt-3 block truncate text-sm font-semibold text-fg">{v.name}</span>
      <span className="mt-1 flex items-center gap-1 truncate text-chips text-muted">
        <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
        {v.address || 'Exhibition stand'}
      </span>
      {shelfLabels.length > 0 && (
        <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-wide text-brand">
          {shelfLabels.slice(0, 3).join(' · ')}
        </span>
      )}
      <span className="mt-2 text-chips font-medium text-accent">
        {count} product{count === 1 ? '' : 's'}
      </span>
    </button>
  )
}

function AllStandsContent() {
  const router = useRouter()
  const { catalog, error, loading, availableBranches, branchCode, branchName, changeBranch } = useExhibitionBranch()
  const [query, setQuery] = useState('')

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])

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
                <Skeleton key={i} className="h-32 rounded-2xl" />
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
              {stands.map((v) => (
                <StandTile key={v.id} v={v} count={vendorCounts[v.id] || 0} shelfLabels={shelfLabelsByVendor[v.id]} />
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
