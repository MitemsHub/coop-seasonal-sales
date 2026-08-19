'use client'

// app/components/ExhibitionProductCard.jsx
// One exhibition product card — the shared buying unit across the shop, the
// all-products page and the vendor hub. Image, price (+ negotiated chip),
// stock and the qty stepper all live here so the three surfaces can't drift.
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Minus, Plus } from 'lucide-react'
import Badge from './ui/Badge'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

export default function ExhibitionProductCard({ p, qty, onAdd, showVendor = true }) {
  const router = useRouter()

  const image = (
    <Image
      src={p.image_url || '/images/items/placeholder.svg'}
      alt={p.name}
      fill
      sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 18vw"
      className="object-cover transition-transform duration-500 ease-sakani group-hover:scale-[1.05]"
      loading="lazy"
      onError={(e) => {
        e.currentTarget.src = '/images/items/placeholder.svg'
      }}
    />
  )

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
      {/* Uniform 4:3 image — keeps the card compact so more fit per row */}
      {showVendor ? (
        <button
          type="button"
          onClick={() => router.push(`/exhibition/vendor/${p.vendor_id}`)}
          aria-label={`View ${p.vendor_name || 'vendor'} hub`}
          className="relative block aspect-[4/3] w-full overflow-hidden bg-subtle"
        >
          {image}
          <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {p.vendor_name}
          </span>
        </button>
      ) : (
        <div className="relative block aspect-[4/3] w-full overflow-hidden bg-subtle">{image}</div>
      )}

      <div className="flex flex-1 flex-col p-2">
        <div className="text-xs font-semibold leading-snug break-words text-fg">{p.name}</div>
        <div className="mb-1.5 mt-0.5 flex flex-wrap items-center gap-x-1 text-chips text-muted">
          <span>{p.unit}</span>
          {p.qty !== null && p.qty !== undefined && p.qty > 0 && (
            <span className="font-medium text-success-fg">· {p.qty} left</span>
          )}
        </div>

        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="text-sm font-bold text-brand tabular-nums">{naira(p.price)}</div>
          {p.negotiated ? (
            <Badge tone="accent" variant="subtle">
              Your price
            </Badge>
          ) : p.final_price !== p.price ? (
            <span className="text-chips text-muted line-through">{naira(p.final_price)}</span>
          ) : null}
        </div>

        {p.qty === 0 ? (
          <div
            role="status"
            className="mt-auto flex w-full items-center justify-center rounded-lg bg-subtle/60 px-2 py-1.5 text-xs font-semibold text-danger-fg"
          >
            Sold out
          </div>
        ) : (
          <div className="mt-auto flex items-center justify-center gap-1.5 rounded-lg bg-subtle/60 px-1.5 py-1">
            <button
              type="button"
              aria-label={`Decrease ${p.name}`}
              onClick={() => onAdd(-1)}
              disabled={qty <= 0}
              className={[
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                qty > 0 ? 'bg-subtle text-fg hover:bg-line-subtle' : 'bg-subtle text-subtext',
              ].join(' ')}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <div className="flex h-6 w-9 items-center justify-center rounded-md border border-line-subtle bg-surface text-center text-xs font-semibold tabular-nums text-fg">
              {qty}
            </div>
            <button
              type="button"
              aria-label={`Increase ${p.name}`}
              onClick={() => onAdd(1)}
              disabled={p.qty !== null && p.qty !== undefined && qty >= p.qty}
              title={p.qty !== null && p.qty !== undefined && qty >= p.qty ? 'No more stock available' : undefined}
              className={[
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                p.qty !== null && p.qty !== undefined && qty >= p.qty
                  ? 'bg-subtle text-subtext'
                  : 'bg-brand-subtle text-brand hover:bg-brand/20',
              ].join(' ')}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
