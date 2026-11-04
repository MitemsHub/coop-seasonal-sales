'use client'

// app/vendor/insights/page.jsx
// What shoppers did at this stand in the last 30 days: views, adds, the
// conversion between them, and the searches that found nothing.
import { useEffect, useState } from 'react'
import { Eye, Search, ShoppingCart, TrendingUp } from 'lucide-react'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

export default function VendorInsightsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/vendor/analytics', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (json?.ok) setData(json)
        else setError(json?.error || 'Could not load insights')
      } catch {
        if (!cancelled) setError('Could not reach the server.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) return <div className="p-4 text-sm text-danger-fg">{error}</div>
  if (!data) return <div className="p-4 text-sm text-muted">Loading insights…</div>

  const cards = [
    { label: 'Product views', value: data.totals.views.toLocaleString(), icon: Eye },
    { label: 'Adds to cart', value: data.totals.adds.toLocaleString(), icon: ShoppingCart },
    { label: 'Add rate', value: `${data.totals.conversion}%`, icon: TrendingUp },
    { label: 'Live products', value: data.totals.products.toLocaleString(), icon: Eye },
  ]

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="font-display text-h1 font-semibold tracking-tight text-fg">Insights</h1>
      <p className="mt-1 text-sm text-muted">Last {data.days} days at your stand.</p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-line bg-surface p-3">
            <c.icon className="h-4 w-4 text-accent" strokeWidth={2} />
            <div className="mt-2 text-xl font-bold tabular-nums text-fg">{c.value}</div>
            <div className="text-chips font-medium text-muted">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Products</h2>
          <p className="text-chips text-muted">Views and add-to-cart rate per product</p>
        </div>
        {data.products.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">No views recorded yet.</div>
        ) : (
          <div className="divide-y divide-line-subtle">
            {data.products.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{p.name}</p>
                  <p className="text-chips text-muted">{naira(p.price)}</p>
                </div>
                <div className="w-16 text-right text-sm tabular-nums text-fg">{p.views}</div>
                <div className="w-16 text-right text-sm tabular-nums text-fg">{p.adds}</div>
                <div className="w-14 text-right text-chips font-semibold text-accent">{p.rate}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Search className="h-4 w-4" strokeWidth={2} /> Searches that found nothing
        </h2>
        <p className="mt-0.5 text-chips text-muted">
          What shoppers looked for and the whole market could not answer — a listing opportunity.
        </p>
        {data.emptySearches.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No missed searches.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.emptySearches.map((s) => (
              <span key={s.query} className="rounded-full border border-line bg-subtle px-2.5 py-1 text-chips text-fg">
                {s.query} <span className="text-muted">×{s.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
