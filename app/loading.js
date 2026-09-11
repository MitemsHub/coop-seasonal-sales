// app/loading.js — Root loading skeleton
// Branded loading state shown during Next.js route transitions. Features the
// Coop logo and a shimmer skeleton that matches the page layout.
import Image from 'next/image'

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Brand loading indicator */}
      <div className="mb-10 flex flex-col items-center gap-4">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-line-subtle bg-surface shadow-lg shadow-brand/5">
          <Image
            src="/logo.png"
            alt="Loading"
            width={44}
            height={44}
            className="h-11 w-11 animate-pulse object-contain"
            priority
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand" />
        </div>
      </div>

      {/* Content skeleton */}
      <div className="space-y-4">
        <div className="sakani-skeleton h-8 w-64 rounded-lg" />
        <div className="sakani-skeleton h-4 w-96 max-w-full rounded-lg" />
        <div className="sakani-skeleton h-4 w-72 max-w-full rounded-lg" />
      </div>

      {/* Card grid skeleton */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
