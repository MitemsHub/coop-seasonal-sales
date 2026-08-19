// app/my-coop/loading.js — My Coop dashboard loading skeleton
export default function MyCoopLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Welcome header */}
      <div className="mb-8 space-y-2">
        <div className="sakani-skeleton h-7 w-64 rounded-lg" />
        <div className="sakani-skeleton h-4 w-48 rounded-lg" />
      </div>

      {/* Quick action cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-5">
            <div className="sakani-skeleton mb-3 h-10 w-10 rounded-xl" />
            <div className="sakani-skeleton mb-2 h-5 w-24 rounded" />
            <div className="sakani-skeleton h-3 w-32 rounded" />
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div className="rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-5 py-3">
          <div className="sakani-skeleton h-4 w-32 rounded" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="sakani-skeleton h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <div className="sakani-skeleton h-3.5 w-48 rounded" />
                <div className="sakani-skeleton h-2.5 w-32 rounded" />
              </div>
              <div className="sakani-skeleton h-5 w-16 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
