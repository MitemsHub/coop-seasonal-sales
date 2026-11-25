'use client'

// app/components/ExhibitionCatalog.jsx
// The full exhibition catalogue surface. Used by /exhibition/all (and any page
// that wants the whole shelf with a vendor filter). When `pageSize` is set the
// grid paginates, so a 100+ product market stays browsable. `beforeGrid` lets a
// page slot content between the filters and the grid.
//
// Search, shelf pills, stock/offer/price refinements and sort are the shared
// ExhibitionFilterBar over useExhibitionFilters, which is what the shop uses
// too — this page only adds the vendor hub filter and the pager.
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Store } from 'lucide-react'
import CartStickyBar from './CartStickyBar'
import ExhibitionCycleHint from './ExhibitionCycleHint'
import useExhibitionCart from '../hooks/useExhibitionCart'
import useExhibitionFilters from '../hooks/useExhibitionFilters'
import SearchableSelect from './ui/SearchableSelect'
import EmptyState from './ui/EmptyState'
import ExhibitionFilterBar from './ExhibitionFilterBar'
import ExhibitionProductCard from './ExhibitionProductCard'
import ExhibitionProductSkeleton from './ExhibitionProductSkeleton'

export default function ExhibitionCatalog({
  catalog,
  loading,
  error,
  pageSize = 0,
  showVendor = true,
  beforeGrid = null,
}) {
  const router = useRouter()
  const { addToCart, qtyOf, cartCount, cartTotal } = useExhibitionCart()

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])
  const filters = useExhibitionFilters(products)

  const [vendorId, setVendorId] = useState(null)
  const [page, setPage] = useState(0)

  // The vendor hub is the one filter this page owns.
  const filtered = useMemo(
    () => (vendorId ? filters.filtered.filter((p) => p.vendor_id === vendorId) : filters.filtered),
    [filters.filtered, vendorId]
  )

  const vendorsWithProducts = useMemo(() => {
    const ids = new Set(products.map((p) => p.vendor_id))
    return vendors.filter((v) => ids.has(v.id))
  }, [vendors, products])

  useEffect(() => {
    setPage(0)
  }, [filters.signature, vendorId])

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1
  const safePage = Math.min(page, pageCount - 1)
  const visible = pageSize > 0 ? filtered.slice(safePage * pageSize, safePage * pageSize + pageSize) : filtered

  return (
    <>
      {!!error && (
        <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</div>
      )}

      <ExhibitionFilterBar filters={filters} className="mb-4" />

      {/* Vendor hub selector — a searchable combobox so the filter stays
          usable no matter how many stands the branch has. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-chips font-medium uppercase tracking-wider text-muted">
          <Store className="h-3 w-3" strokeWidth={2.2} />
          Vendor hubs
        </span>
        <SearchableSelect
          options={vendorsWithProducts.map((v) => ({ value: String(v.id), label: v.name }))}
          value={vendorId == null ? null : String(vendorId)}
          onSelect={(v) => setVendorId(v == null ? null : Number(v))}
          allLabel={`All vendors (${vendorsWithProducts.length})`}
          ariaLabel="Filter by vendor hub"
          className="w-full sm:w-72"
        />
      </div>

      {/* Page-slot content (a page's own content above the grid) */}
      {!loading && beforeGrid}

      {/* Product grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7">
          {Array.from({ length: 12 }).map((_, i) => (
            <ExhibitionProductSkeleton key={i} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Nothing here yet"
          description={filters.isFiltering || vendorId
            ? 'No products match your filters. Try clearing them.'
            : catalog?.cycle?.starts_at || catalog?.cycle?.ends_at
              ? (
                  <>
                    Vendors are still setting up their stands —{' '}
                    <ExhibitionCycleHint cycle={catalog.cycle} />. Check back soon.
                  </>
                )
              : 'Vendors are still setting up their stands. Check back soon.'}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7">
          {visible.map((p) => (
            <ExhibitionProductCard
              key={p.id}
              p={p}
              qty={qtyOf(p.id)}
              onAdd={(d) => addToCart(p, d)}
              showVendor={showVendor}
            />
          ))}
        </div>
      )}

      {/* Pagination — only when the surface opts in via pageSize */}
      {pageCount > 1 && (
        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-chips font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:pointer-events-none disabled:opacity-50"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <span className="text-chips text-muted">
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-chips font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:pointer-events-none disabled:opacity-50"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Sticky cart bar — shared component so every shopping surface stays in sync */}
      <CartStickyBar
        count={cartCount}
        total={cartTotal}
        subtitle="Co-op approved member prices"
        onGoToCart={() => router.push('/exhibition/cart')}
      />
    </>
  )
}
