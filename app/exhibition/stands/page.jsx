// app/exhibition/stands/page.jsx
// Where "View all" on the Featured stands rail lands: every stand at the
// member's pickup location, one card each — no products mixed in. Opening a
// card shows that stand's products (/exhibition/vendor/[id]), which is the
// browsing order the shop promises: stands first, then their shelves.
// The full product catalogue stays at /exhibition/all.
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, PackageSearch, Search, Store } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import ExhibitionCycleHint from '../../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../../components/ContinueShoppingBanner'
import ModuleClosedPanel from '../../components/ModuleClosedPanel'
import Skeleton from '../../components/ui/Skeleton'
import useExhibitionCatalog from '../../hooks/useExhibitionCatalog'

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return 'ST'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

function AllStandsContent() {
  const router = useRouter()
  const { catalog, error, loading } = useExhibitionCatalog()
  const [query, setQuery] = useState('')

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])

  const counts = useMemo(() => {
    const map = {}
    for (const p of products) map[p.vendor_id] = (map[p.vendor_id] || 0) + 1
    return map
  }, [products])

  // Only stands with something on the shelf belong in a shopping list.
  const stands = useMemo(() => {
    const stocked = vendors.filter((v) => (counts[v.id] || 0) > 0)
    const q = query.trim().toLowerCase()
    if (!q) return stocked
    return stocked.filter((v) =>
      [v.name, v.address, v.stand_number, v.hall]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q))
    )
  }, [vendors, counts, query])

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

        <div className="relative mx-auto max-w-7xl p-fluid pb-28 sm:pb-32">
          <ContinueShoppingBanner excludeModules={['exhibition']} className="mb-fluid-lg" />

          {/* Header */}
          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
                <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
                Coop Exhibition
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {loading ? 'All stands' : `Stands · ${catalog?.cycle?.name || 'this season'}`}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Every stand at this pickup location. Open a stand to see what it sells.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {loading ? (
                <Skeleton className="h-8 w-24 rounded-full" />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-chips font-medium text-muted">
                  <Store className="h-3.5 w-3.5" />
                  {stands.length.toLocaleString()} stand{stands.length === 1 ? '' : 's'}
                </span>
              )}
              <Link
                href="/exhibition/all"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-chips font-semibold text-fg transition-colors duration-200 ease-sakani hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <PackageSearch className="h-3.5 w-3.5" />
                All products
              </Link>
            </div>
          </div>

          {!!error && (
            <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</div>
          )}

          {/* Search — stands only */}
          <div className="relative mb-5 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stands…"
              aria-label="Search stands"
              className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none"
            />
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
          ) : stands.length === 0 ? (
            <div className="rounded-2xl border border-line-subtle bg-subtle/40 px-4 py-10 text-center">
              <p className="text-sm font-medium text-fg">
                {query ? `No stands match “${query}”` : 'No stands open yet'}
              </p>
              <p className="mt-0.5 text-chips text-muted">
                {query ? 'Try another name, or clear the search.' : 'Vendors are still setting up their stands.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {stands.map((v) => {
                const count = counts[v.id] || 0
                return (
                  <Link
                    key={v.id}
                    href={`/exhibition/vendor/${v.id}`}
                    className="group flex flex-col rounded-2xl border border-line bg-surface p-4 transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-xs font-bold text-accent-fg transition-colors duration-200 group-hover:bg-accent/25">
                        {initials(v.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-fg">{v.name}</div>
                        <div className="truncate text-chips text-muted">{v.address || 'Exhibition stand'}</div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-subtext transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent" />
                    </div>

                    {(v.stand_number || v.hall || v.opening_hours) && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-chips text-muted">
                        {v.stand_number && <span>Stand {v.stand_number}</span>}
                        {v.hall && <span>{v.hall}</span>}
                        {v.opening_hours && <span>{v.opening_hours}</span>}
                      </div>
                    )}

                    <div className="mt-2 text-chips font-medium text-accent">
                      {count} product{count === 1 ? '' : 's'}
                    </div>
                  </Link>
                )
              })}
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
