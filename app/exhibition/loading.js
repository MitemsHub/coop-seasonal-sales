// app/exhibition/loading.js — Exhibition hub loading skeleton
export default function ExhibitionLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 space-y-2">
        <div className="sakani-skeleton h-7 w-56 rounded-lg" />
        <div className="sakani-skeleton h-4 w-72 rounded-lg" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-5">
            <div className="sakani-skeleton mb-3 aspect-[4/3] w-full rounded-lg" />
            <div className="sakani-skeleton mb-2 h-5 w-3/4 rounded" />
            <div className="sakani-skeleton mb-1 h-3 w-1/2 rounded" />
            <div className="mt-3 flex items-center justify-between">
              <div className="sakani-skeleton h-6 w-16 rounded-full" />
              <div className="sakani-skeleton h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
