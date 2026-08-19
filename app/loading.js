// app/loading.js — Root loading skeleton
// Shown during Next.js route transitions. Uses the sakani-skeleton CSS class
// for the animated shimmer effect that already exists in the design system.
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Hero skeleton */}
      <div className="mb-8 space-y-4">
        <div className="sakani-skeleton h-8 w-64 rounded-lg" />
        <div className="sakani-skeleton h-4 w-96 max-w-full rounded-lg" />
        <div className="sakani-skeleton h-4 w-72 max-w-full rounded-lg" />
      </div>

      {/* Card grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-5">
            <div className="sakani-skeleton mb-3 h-10 w-10 rounded-xl" />
            <div className="sakani-skeleton mb-2 h-5 w-3/4 rounded-lg" />
            <div className="sakani-skeleton mb-1 h-3 w-full rounded-lg" />
            <div className="sakani-skeleton h-3 w-2/3 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}
