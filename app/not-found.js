// app/not-found.js — Custom 404 page
import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-subtle">
          <span className="text-2xl font-bold text-brand">404</span>
        </div>

        <h1 className="text-xl font-bold text-fg">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-on-accent shadow-lg transition-all duration-200 hover:bg-brand-hover hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Go to homepage
          </Link>
          <Link
            href="/portal"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-6 py-3 text-sm font-medium text-fg transition-all duration-200 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Member portal
          </Link>
        </div>
      </div>
    </div>
  )
}
