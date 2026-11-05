'use client'

// app/vendor/products/[id]/history/page.jsx
// Every price this product has had, who changed it and when.
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const naira = (v) => (v == null ? '—' : `₦${Number(v).toLocaleString()}`)

export default function ProductHistoryPage() {
  const params = useParams()
  const id = params?.id
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/vendor/exhibition/products/${id}/history`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (json?.ok) setRows(json.history || [])
        else setError(json?.error || 'Could not load history')
      } catch {
        if (!cancelled) setError('Could not reach the server.')
      }
    })()
    return () => { cancelled = true }
  }, [id])

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-h2 font-semibold text-fg">Price history</h1>
      <p className="mt-1 text-sm text-muted">Changes to your price, newest first.</p>

      {error && <p className="mt-4 text-sm text-danger-fg">{error}</p>}
      {!rows && !error && <p className="mt-4 text-sm text-muted">Loading…</p>}
      {rows?.length === 0 && <p className="mt-4 text-sm text-muted">No price changes recorded yet.</p>}

      <div className="mt-4 divide-y divide-line-subtle overflow-hidden rounded-2xl border border-line bg-surface">
        {(rows || []).map((r) => (
          <div key={r.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-fg">
                {naira(r.old_vendor_price)} → {naira(r.new_vendor_price)}
              </span>
              <span className="text-chips text-muted">
                {new Date(r.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="mt-0.5 text-chips text-muted">
              {r.changed_by_label || r.changed_by || 'Price change'}
              {r.note ? ` · ${r.note}` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
