// app/rep/loading.js — Rep panel loading skeleton
// Branded loading state that matches the rep sidebar layout.
import Image from 'next/image'

export default function RepLoading() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar skeleton */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-line px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10">
            <Image src="/logo.png" alt="" width={28} height={28} className="h-7 w-7 animate-pulse object-contain" />
          </div>
          <div className="space-y-1.5">
            <div className="sakani-skeleton h-3.5 w-24 rounded" />
            <div className="sakani-skeleton h-2.5 w-16 rounded" />
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-lg px-3 py-2">
              <div className="sakani-skeleton h-4 w-4 rounded" />
              <div className="sakani-skeleton h-3.5 w-28 rounded" />
            </div>
          ))}
        </nav>
      </aside>

      {/* Content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <div className="sakani-skeleton h-9 w-9 rounded-lg lg:hidden" />
          <div className="min-w-0 flex-1">
            <div className="sakani-skeleton h-4 w-32 rounded" />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="space-y-2">
              <div className="sakani-skeleton h-7 w-48 rounded-lg" />
              <div className="sakani-skeleton h-4 w-72 rounded-lg" />
            </div>
            <div className="rounded-xl border border-line bg-surface">
              <div className="border-b border-line px-4 py-3">
                <div className="sakani-skeleton h-4 w-40 rounded" />
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
                  <div className="sakani-skeleton h-4 flex-1 rounded" />
                  <div className="sakani-skeleton h-4 w-24 rounded" />
                  <div className="sakani-skeleton h-8 w-16 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
