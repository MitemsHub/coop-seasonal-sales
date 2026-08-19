// app/orders/loading.js — Orders page loading skeleton
export default function OrdersLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 space-y-2">
        <div className="sakani-skeleton h-7 w-40 rounded-lg" />
        <div className="sakani-skeleton h-4 w-56 rounded-lg" />
      </div>

      {/* Order cards */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="space-y-1.5">
                <div className="sakani-skeleton h-4 w-32 rounded" />
                <div className="sakani-skeleton h-3 w-24 rounded" />
              </div>
              <div className="sakani-skeleton h-6 w-20 rounded-full" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3">
                  <div className="sakani-skeleton h-3.5 flex-1 rounded" />
                  <div className="sakani-skeleton h-3.5 w-16 rounded" />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <div className="sakani-skeleton h-5 w-24 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
