'use client'

// app/components/ExhibitionProductCard.jsx
// One exhibition product card — the shared buying unit across the shop, the
// all-products page and the vendor hub. Image, price (+ negotiated chip),
// stock and the qty stepper all live here so the three surfaces can't drift.
// The card shows only the cover photo; the remaining photos are in the View
// popup's gallery, so a card never competes with a carousel for a tap.
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import Badge from './ui/Badge'
import Button from './ui/Button'
import DraggableModal from './DraggableModal'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`
const PLACEHOLDER = '/images/items/placeholder.svg'

export default function ExhibitionProductCard({ p, qty, onAdd, showVendor = true }) {
  const router = useRouter()
  const [viewOpen, setViewOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const images =
    Array.isArray(p.images) && p.images.length ? p.images : [p.image_url || PLACEHOLDER]
  const safeIndex = Math.min(index, images.length - 1)
  const many = images.length > 1

  const step = (delta) => setIndex((i) => (i + delta + images.length) % images.length)

  // The popup gallery is driven by swiping the photo. Pointer events cover
  // touch and pen as well as a mouse drag; `touch-action: pan-y` leaves vertical
  // page scrolling alone. The arrow buttons stay for desktops without a touch
  // surface, and the thumbnails jump straight to a photo.
  const swipe = useRef({ x: 0, active: false })
  const onSwipeStart = (e) => {
    if (!many) return
    swipe.current = { x: e.clientX, active: true }
  }
  const onSwipeEnd = (e) => {
    if (!swipe.current.active) return
    const delta = e.clientX - swipe.current.x
    swipe.current.active = false
    if (Math.abs(delta) < 40) return
    step(delta < 0 ? 1 : -1)
  }
  const onSwipeCancel = () => {
    swipe.current.active = false
  }

  // The inset lives on a wrapper, not on the image box: `fill` pins the image
  // to inset-0, so padding on the padded parent was ignored and photos bled to
  // the card's edges (flush against the top).
  const image = (
    <div className="absolute inset-1.5">
      <Image
        src={images[0]}
        alt={p.name}
        fill
        sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 18vw"
        // Contain, not cover: a photo the vendor framed themselves should show
        // in full instead of losing its edges to the card.
        className="object-contain transition-transform duration-500 ease-sakani group-hover:scale-[1.03]"
        loading="lazy"
        onError={(e) => {
          e.currentTarget.src = PLACEHOLDER
        }}
      />
    </div>
  )

  const imageArea = (
    <div className="relative block aspect-[4/3] w-full overflow-hidden bg-white dark:bg-subtle">
      {image}
      {showVendor ? (
        <button
          type="button"
          onClick={() => router.push(`/exhibition/vendor/${p.vendor_id}`)}
          aria-label={`View ${p.vendor_name || 'vendor'} hub`}
          className="absolute inset-0 z-10"
        />
      ) : null}
    </div>
  )

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
      {/* Uniform 4:3 image — keeps the card compact so more fit per row */}
      {imageArea}

      <div className="flex flex-1 flex-col p-2">
        {/* Two lines max so a very long product name can't stretch the card
            (or the grid row) and squash the price and stepper. */}
        <div className="line-clamp-2 break-words text-xs font-semibold leading-snug text-fg" title={p.name}>{p.name}</div>
        {(!!p.description || many) && (
          <div className="mt-0.5 flex items-start gap-1">
            <p className="line-clamp-2 min-w-0 flex-1 break-words text-[11px] leading-snug text-muted" title={p.description}>
              {p.description}
            </p>
            <button
              type="button"
              onClick={() => setViewOpen(true)}
              aria-label={`View details for ${p.name}`}
              className="shrink-0 text-[11px] font-semibold leading-snug text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              View
            </button>
          </div>
        )}
        <div className="mb-1.5 mt-0.5 flex flex-wrap items-center gap-x-1 text-chips text-muted">
          <span>{p.unit}</span>
          {p.qty !== null && p.qty !== undefined && p.qty > 0 && (
            <span className="font-medium text-success-fg">· {p.qty} left</span>
          )}
          {many && <span className="ml-auto font-medium text-brand">{images.length} photos</span>}
        </div>

        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-sm font-bold text-brand tabular-nums">{naira(p.price)}</span>
            {!p.negotiated && p.final_price !== p.price && (
              <span className="text-chips text-muted line-through">{naira(p.final_price)}</span>
            )}
          </div>
          {p.discount_pct > 0 ? (
            <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-[10px] font-semibold text-danger-fg">
              −{p.discount_pct}%
            </span>
          ) : p.negotiated ? (
            <Badge tone="accent" variant="subtle">
              Your price
            </Badge>
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
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-[color,background-color,scale] duration-150 active:scale-[0.97]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                qty > 0 ? 'bg-subtle text-fg hover:bg-line-subtle' : 'bg-subtle text-subtext',
              ].join(' ')}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <div className="flex h-6 w-9 items-center justify-center rounded-md border border-line-subtle bg-surface text-center text-xs font-semibold tabular-nums text-fg">
              {/* Remounts per value so the new quantity pops into place. */}
              <span key={qty} className="pop">
                {qty}
              </span>
            </div>
            <button
              type="button"
              aria-label={`Increase ${p.name}`}
              onClick={() => onAdd(1)}
              disabled={p.qty !== null && p.qty !== undefined && qty >= p.qty}
              title={p.qty !== null && p.qty !== undefined && qty >= p.qty ? 'No more stock available' : undefined}
              className={[
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-[color,background-color,scale] duration-150 active:scale-[0.97]',
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

      <DraggableModal
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        title="Product details"
        align="center"
        widthClass="max-w-lg w-full mx-4"
        footer={
          <Button variant="secondary" onClick={() => setViewOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          {/* Gallery — same index as the card, so stepping here starts where
              the member left off. */}
          <div
            className="relative flex h-56 w-full select-none items-center justify-center overflow-hidden rounded-xl border border-line-subtle bg-white p-2 sm:h-72 dark:bg-subtle"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={onSwipeStart}
            onPointerUp={onSwipeEnd}
            onPointerCancel={onSwipeCancel}
            onPointerLeave={onSwipeCancel}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[safeIndex]}
              alt={many ? `${p.name} — photo ${safeIndex + 1} of ${images.length}` : p.name}
              draggable={false}
              className="pointer-events-none h-full w-full object-contain"
              onError={(e) => {
                e.currentTarget.src = PLACEHOLDER
              }}
            />
            {many && (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="Previous photo"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/90 p-1.5 text-fg shadow-sm backdrop-blur hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Next photo"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/90 p-1.5 text-fg shadow-sm backdrop-blur hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
                </button>
                <span className="absolute right-2 top-2 rounded-full bg-fg/70 px-2 py-0.5 text-[10px] font-semibold text-on-accent tabular-nums">
                  {safeIndex + 1}/{images.length}
                </span>
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-fg/60 px-2 py-0.5 text-[10px] font-medium text-on-accent">
                  Swipe for more photos
                </span>
              </>
            )}
          </div>

          {many && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Show photo ${i + 1}`}
                  aria-current={i === safeIndex}
                  className={[
                    'shrink-0 overflow-hidden rounded-lg border-2 transition-colors',
                    i === safeIndex ? 'border-brand' : 'border-line-subtle hover:border-line-strong',
                  ].join(' ')}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-14 w-14 object-cover" />
                </button>
              ))}
            </div>
          )}

          <div>
            <h3 className="break-words text-base font-semibold text-fg">{p.name}</h3>
            {showVendor && p.vendor_name && (
              <p className="mt-0.5 text-chips text-muted">{p.vendor_name}</p>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-lg font-bold text-brand tabular-nums">{naira(p.price)}</span>
            {!p.negotiated && p.final_price !== p.price && (
              <span className="text-sm text-muted line-through">{naira(p.final_price)}</span>
            )}
            {p.discount_pct > 0 && (
              <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-[10px] font-semibold text-danger-fg">
                −{p.discount_pct}%
              </span>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-chips text-muted">
            <span>{p.unit}</span>
            {p.qty !== null && p.qty !== undefined && (
              <span className={p.qty > 0 ? 'font-medium text-success-fg' : 'font-medium text-danger-fg'}>
                · {p.qty > 0 ? `${p.qty} left` : 'Sold out'}
              </span>
            )}
          </p>
          {!!p.description && (
            <div className="border-t border-line-subtle pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Description</h4>
              {/* Long descriptions scroll inside the popup instead of stretching
                  it past the viewport, which on phones pushed Close off-screen. */}
              <p className="mt-1 max-h-40 overflow-y-auto overscroll-contain whitespace-pre-line break-words pr-1 text-sm leading-relaxed text-fg">
                {p.description}
              </p>
            </div>
          )}
        </div>
      </DraggableModal>
    </div>
  )
}
