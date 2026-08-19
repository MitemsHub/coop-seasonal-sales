'use client'

// app/components/ExhibitionCatalog.jsx
// The shared exhibition shopping surface: search, category chips, vendor
// filter, the product grid and the sticky cart bar. Used by /exhibition (the
// shop) and /exhibition/all (the full catalog page). When `pageSize` is set
// the grid paginates, so a 100+ product market stays browsable. `beforeGrid`
// lets a page slot content between the filters and the grid (the shop's hub
// slideshow).
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Search, Store, Tag, X } from 'lucide-react'
import CartStickyBar from './CartStickyBar'
import ExhibitionCycleHint from './ExhibitionCycleHint'
import useExhibitionCart from '../hooks/useExhibitionCart'
import SearchableSelect from './ui/SearchableSelect'
import Skeleton from './ui/Skeleton'
import EmptyState from './ui/EmptyState'
import ExhibitionProductCard from './ExhibitionProductCard'

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
  const [categoryId, setCategoryId] = useState(null)
  const [vendorId, setVendorId] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])
  const categories = useMemo(() => catalog?.categories || [], [catalog])

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (categoryId && p.category_id !== categoryId) return false
      if (vendorId && p.vendor_id !== vendorId) return false
      if (search) {
        const s = search.toLowerCase()
        if (!p.name.toLowerCase().includes(s) && !p.vendor_name.toLowerCase().includes(s)) return false
      }
      return true
    })
  }, [products, categoryId, vendorId, search])

  // Group filter options by the vendors that actually have products
  const vendorsWithProducts = useMemo(() => {
    const ids = new Set(products.map((p) => p.vendor_id))
    return vendors.filter((v) => ids.has(v.id))
  }, [vendors, products])

  useEffect(() => {
    setPage(0)
  }, [categoryId, vendorId, search])

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1
  const safePage = Math.min(page, pageCount - 1)
  const visible = pageSize > 0 ? filtered.slice(safePage * pageSize, safePage * pageSize + pageSize) : filtered

  return (
    <>
      {!!error && (
        <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</div>
      )}

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products or vendors…"
          className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-8 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        {!!search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-subtle hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Category chips */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
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
        {categories.map((c) => (
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

      {/* Page-slot content (the shop's hub slideshow sits here) */}
      {!loading && beforeGrid}

      {/* Product grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Nothing here yet"
          description={search || categoryId || vendorId
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
        subtitle="Negotiated prices applied where they exist"
        onGoToCart={() => router.push('/exhibition/cart')}
      />
    </>
  )
}
