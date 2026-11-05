'use client'

// app/components/ExhibitionProductCard.jsx
// One exhibition product card — the shared buying unit across the shop, the
// all-products page and the vendor hub. Image, price (+ negotiated chip),
// stock and the qty stepper all live here so the three surfaces can't drift.
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import Badge from './ui/Badge'
import Button from './ui/Button'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

export default function ExhibitionProductCard({ p, qty, onAdd, showVendor = true }) {
  const router = useRouter()
  // Optional services (installation …) are offered when the member adds the
  // item, the way marketplaces sell add-ons: they belong to the product, not
  // to the shelf.
  const addons = Array.isArray(p.addons) ? p.addons : []
  const [addonOpen, setAddonOpen] = useState(false)
  const [picked, setPicked] = useState([])

  // Stand artwork is usually a square emblem on a plain background; cropping
  // it to 4:3 sliced off the top and bottom, so the image is contained inside
  // the frame instead of covering it.
  const imageBox = (
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-subtle">
      <div className="absolute inset-2">
        <Image
          src={p.image_url || '/images/items/placeholder.svg'}
          alt={p.name}
          fill
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 18vw"
          className="object-contain transition-transform duration-500 ease-sakani group-hover:scale-[1.04]"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = '/images/items/placeholder.svg'
          }}
        />
      </div>
    </div>
  )

  return (
    <>
    <div className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
      {/* Uniform 4:3 frame — the whole artwork stays visible, and no stand
          label sits on top of it. */}
      {showVendor ? (
        <button
          type="button"
          onClick={() => router.push(`/exhibition/vendor/${p.vendor_id}`)}
          aria-label={`View ${p.vendor_name || 'vendor'} hub`}
          className="block w-full"
        >
          {imageBox}
        </button>
      ) : (
        imageBox
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
              onClick={() => (addons.length ? (setPicked([]), setAddonOpen(true)) : onAdd(1))}
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

    {addonOpen && (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-label={`Services for ${p.name}`}
      >
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-4 shadow-xl">
          <div className="text-sm font-semibold text-fg">{p.name}</div>
          <p className="mt-0.5 text-chips text-muted">Add optional services to this item.</p>
          <div className="mt-3 space-y-1.5">
            {addons.map((a) => {
              const on = picked.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() =>
                    setPicked((cur) => (on ? cur.filter((x) => x !== a.id) : [...cur, a.id]))
                  }
                  aria-pressed={on}
                  className={[
                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors duration-150',
                    on ? 'border-brand bg-brand-subtle' : 'border-line bg-surface hover:bg-subtle',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      on ? 'border-brand bg-brand text-on-accent' : 'border-line-strong',
                    ].join(' ')}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg">{a.name}</span>
                  <span className="font-semibold tabular-nums text-fg">{naira(a.price)}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAddonOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onAdd(1, addons.filter((a) => picked.includes(a.id)))
                setAddonOpen(false)
              }}
            >
              {picked.length ? `Add with ${picked.length} service${picked.length === 1 ? '' : 's'}` : 'Add to cart'}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
