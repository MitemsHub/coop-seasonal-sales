'use client'

// A visible way back from a page that the top nav does not cover (a stand, the
// catalogue, checkout). Uses an explicit href when the parent is known, and
// history otherwise.
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

export default function BackLink({ href, label = 'Back', className = '' }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => (href ? router.push(href) : router.back())}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-chips font-semibold text-fg transition-colors duration-200 ease-sakani hover:border-line-strong hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
      {label}
    </button>
  )
}
