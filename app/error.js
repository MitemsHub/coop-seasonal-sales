'use client'

// app/error.js — Root error boundary
// Catches unhandled runtime errors on any page and shows a friendly
// recovery UI instead of a blank screen.
import { useEffect } from 'react'

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('Unhandled error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* Error icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-danger-subtle">
          <svg className="h-8 w-8 text-danger-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-fg">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          An unexpected error occurred. This has been logged and our team can
          investigate. You can try again below.
        </p>

        {/* Error details (collapsed) */}
        {error?.message && (
          <details className="mt-4 rounded-xl border border-line bg-subtle p-3 text-left">
            <summary className="cursor-pointer text-xs font-medium text-muted">
              Error details
            </summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-danger-fg">
              {error.message}
              {error.digest && `\n\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-on-accent shadow-lg transition-all duration-200 hover:bg-brand-hover hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-6 py-3 text-sm font-medium text-fg transition-all duration-200 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Go to homepage
          </a>
        </div>
      </div>
    </div>
  )
}
