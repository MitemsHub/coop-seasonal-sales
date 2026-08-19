// app/shop/loading.js — Shop loading skeleton
export default function ShopLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 space-y-2">
        <div className="sakani-skeleton h-7 w-48 rounded-lg" />
        <div className="sakani-skeleton h-4 w-72 rounded-lg" />
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="sakani-skeleton h-9 w-24 rounded-lg" />
        ))}
      </div>

      {/* Product grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-4">
            <div className="sakani-skeleton mb-3 aspect-square w-full rounded-lg" />
            <div className="sakani-skeleton mb-2 h-4 w-3/4 rounded" />
            <div className="sakani-skeleton mb-1 h-3 w-1/2 rounded" />
            <div className="mt-3 flex items-center justify-between">
              <div className="sakani-skeleton h-5 w-20 rounded" />
              <div className="sakani-skeleton h-8 w-16 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
