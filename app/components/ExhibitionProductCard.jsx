'use client'

// app/components/ExhibitionProductCard.jsx
// One exhibition product card — the shared buying unit across the shop, the
// all-products page, the vendor hub and the deals rail. Image, price, stock
// and the qty stepper all live here so the surfaces can't drift.
//
// Buying rules this card follows:
//   - Tapping the photo opens the product. It used to jump straight to the
//     vendor's stand, which surprised members and lost the sale they were
//     looking at; the stand is one deliberate tap away (the vendor line).
//   - A tap that adds to the cart says so: the stepper flashes, a small
//     "Added" pill appears on the photo, and the first add of the session
//     gets a short confetti burst.
//   - Stock is on the photo, where it is read before the name: "Sold out"
//     dims the whole photo, "Only N left" warns before the member scrolls on.
//   - The details popup can add to the cart too, so a member who checked the
//     photos is not sent back to the grid to buy.
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Check, Minus, Plus, ShoppingCart, Store } from 'lucide-react'
import Badge from './ui/Badge'
import Button from './ui/Button'
import DraggableModal from './DraggableModal'
import { celebrateFirstAdd } from '../../lib/celebrate'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`
const PLACEHOLDER = '/images/items/placeholder.svg'
const LOW_STOCK = 5

// The stepper is rendered twice (card body + details popup) at two sizes, so
// it lives here rather than being duplicated.
function Stepper({ qty, max, name, onAdd, size = 'sm' }) {
  const big = size === 'md'
  const atMax = max !== null && max !== undefined && qty >= max
  return (
    <div
      className={[
        'flex items-center justify-center gap-1.5 rounded-lg bg-subtle/60',
        big ? 'px-2 py-1.5' : 'px-1.5 py-1',
      ].join(' ')}
    >
      <button
        type="button"
        aria-label={`Decrease ${name}`}
        onClick={() => onAdd(-1)}
        disabled={qty <= 0}
        className={[
          'inline-flex shrink-0 items-center justify-center rounded-full transition-[color,background-color,scale] duration-150 active:scale-[0.97]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          big ? 'h-8 w-8' : 'h-6 w-6',
          qty > 0 ? 'bg-subtle text-fg hover:bg-line-subtle' : 'bg-subtle text-subtext',
        ].join(' ')}
      >
        <Minus className={big ? 'h-4 w-4' : 'h-3.5 w-3.5'} strokeWidth={2.5} />
      </button>
      <div
        className={[
          'flex items-center justify-center rounded-md border border-line-subtle bg-surface text-center font-semibold tabular-nums text-fg',
          big ? 'h-8 w-12 text-sm' : 'h-6 w-9 text-xs',
        ].join(' ')}
      >
        {/* Remounts per value so the new quantity pops into place. */}
        <span key={qty} className="pop">
          {qty}
        </span>
      </div>
      <button
        type="button"
        aria-label={`Increase ${name}`}
        onClick={() => onAdd(1)}
        disabled={atMax}
        title={atMax ? 'No more stock available' : undefined}
        className={[
          'inline-flex shrink-0 items-center justify-center rounded-full transition-[color,background-color,scale] duration-150 active:scale-[0.97]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          big ? 'h-8 w-8' : 'h-6 w-6',
          atMax ? 'bg-subtle text-subtext' : 'bg-brand-subtle text-brand hover:bg-brand/20',
        ].join(' ')}
      >
        <Plus className={big ? 'h-4 w-4' : 'h-3.5 w-3.5'} strokeWidth={2.5} />
      </button>
    </div>
  )
}

export default function ExhibitionProductCard({ p, qty, onAdd, showVendor = true }) {
  const router = useRouter()
  const [viewOpen, setViewOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [added, setAdded] = useState(false)
  const addedTimer = useRef(null)
  const [flashKey, setFlashKey] = useState(0)

  useEffect(() => () => clearTimeout(addedTimer.current), [])

  const images =
    Array.isArray(p.images) && p.images.length ? p.images : [p.image_url || PLACEHOLDER]
  const safeIndex = Math.min(index, images.length - 1)
  const many = images.length > 1

  const soldOut = p.qty === 0
  const lowStock = p.qty !== null && p.qty !== undefined && p.qty > 0 && p.qty <= LOW_STOCK

  // Every add funnels through here so the flash, the confetti and the cart
  // write all happen together no matter which control was tapped.
  const add = (delta) => {
    if (delta > 0) {
      celebrateFirstAdd()
      setAdded(true)
      setFlashKey((k) => k + 1)
      clearTimeout(addedTimer.current)
      addedTimer.current = setTimeout(() => setAdded(false), 1400)
    }
    onAdd(delta)
  }

  const step = (delta) => setIndex((i) => (i + delta + images.length) % images.length)

  // The popup gallery is swipe-only: pointer events cover touch and pen as well
  // as a mouse drag, `touch-action: pan-y` leaves vertical page scrolling alone,
  // and the thumbnails jump straight to a photo. Without arrow buttons a mouse
  // user still needs a way in, so the gallery is focusable and responds to the
  // left/right arrow keys.
  //
  // The photos sit side by side on one track: while a finger/mouse is down the
  // track follows it (no transition), and on release it glides to the chosen
  // photo. That reads as one continuous swipe instead of a hard cut.
  //
  // There is nothing beyond the first or last photo, so dragging past either
  // edge only stretches the track a little (rubber-band) instead of sliding
  // empty space into view.
  const swipe = useRef({ x: 0, active: false })
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const EDGE_RESISTANCE = 0.3
  const resistEdge = (raw) => {
    const pastFirst = safeIndex === 0 && raw > 0
    const pastLast = safeIndex === images.length - 1 && raw < 0
    return pastFirst || pastLast ? raw * EDGE_RESISTANCE : raw
  }

  const onSwipeStart = (e) => {
    if (!many) return
    swipe.current = { x: e.clientX, active: true }
    // Capture so the swipe keeps tracking even if the pointer leaves the box.
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDragging(true)
  }
  const onSwipeMove = (e) => {
    if (!swipe.current.active) return
    setDrag(resistEdge(e.clientX - swipe.current.x))
  }
  const onSwipeEnd = (e) => {
    if (!swipe.current.active) return
    const delta = e.clientX - swipe.current.x
    swipe.current.active = false
    setDragging(false)
    setDrag(0)
    if (Math.abs(delta) < 40) return
    step(delta < 0 ? 1 : -1)
  }
  const onSwipeCancel = () => {
    if (!swipe.current.active) return
    swipe.current.active = false
    setDragging(false)
    setDrag(0)
  }
  const onGalleryKeyDown = (e) => {
    if (!many) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      step(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      step(1)
    }
  }
  const goTo = (i) => {
    setDrag(0)
    setIndex(i)
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

      {/* The photo opens the product, not the stand. */}
      <button
        type="button"
        onClick={() => setViewOpen(true)}
        aria-label={`View details for ${p.name}`}
        className="absolute inset-0 z-10 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50"
      />

      {/* Read before the name: discount, then stock. */}
      {p.discount_pct > 0 && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded-full bg-danger-solid px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
          −{p.discount_pct}%
        </span>
      )}
      {lowStock && !soldOut && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-20 inline-flex items-center gap-1 rounded-full bg-warning-solid px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-white/90" aria-hidden="true" />
          Only {p.qty} left
        </span>
      )}
      {soldOut && (
        <span className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-canvas/65 backdrop-blur-[1px]">
          <span className="rounded-full bg-fg/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-on-accent shadow-sm">
            Sold out
          </span>
        </span>
      )}
      {added && (
        <span
          key={flashKey}
          className="pop pointer-events-none absolute bottom-1.5 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-success-solid px-2 py-0.5 text-[10px] font-bold text-white shadow-md"
        >
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
          Added
        </span>
      )}
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
        {showVendor && p.vendor_name ? (
          <button
            type="button"
            onClick={() => router.push(`/exhibition/vendor/${p.vendor_id}`)}
            aria-label={`Open ${p.vendor_name} stand`}
            className="mt-0.5 flex w-full items-center gap-1 text-left text-[11px] font-medium text-muted transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Store className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="truncate">{p.vendor_name}</span>
          </button>
        ) : null}

        <div className="mb-1.5 mt-1 flex flex-wrap items-center gap-x-1 text-chips text-muted">
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
          {p.negotiated ? (
            <Badge tone="accent" variant="subtle">
              Your price
            </Badge>
          ) : p.discount_pct > 0 ? (
            <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-[10px] font-semibold text-danger-fg">
              Save {naira(Number(p.final_price || 0) - Number(p.price || 0))}
            </span>
          ) : null}
        </div>

        {soldOut ? (
          <div
            role="status"
            className="mt-auto flex w-full items-center justify-center rounded-lg bg-subtle/60 px-2 py-1.5 text-xs font-semibold text-danger-fg"
          >
            Sold out
          </div>
        ) : (
          <div
            className={[
              'mt-auto rounded-lg transition-shadow duration-300',
              added ? 'bg-success-bg ring-1 ring-success-border' : '',
            ].join(' ')}
          >
            <Stepper qty={qty} max={p.qty} name={p.name} onAdd={add} />
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
          <div className="flex items-end gap-2">
            {soldOut ? (
              <div
                role="status"
                className="flex h-11 flex-1 items-center justify-center rounded-lg bg-subtle/60 text-sm font-semibold text-danger-fg"
              >
                Sold out
              </div>
            ) : (
              <>
                <Stepper qty={qty} max={p.qty} name={p.name} onAdd={add} size="md" />
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={() => add(1)}
                  disabled={p.qty !== null && p.qty !== undefined && qty >= p.qty}
                  leftIcon={added ? Check : ShoppingCart}
                >
                  {added ? 'Added' : qty > 0 ? `Add another · ${naira(p.price)}` : 'Add to cart'}
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          {/* Gallery — same index as the card, so stepping here starts where
              the member left off. */}
          {/* Focusable with no arrow buttons: the keyboard is the fallback for
              a mouse-only desktop, and the pointer handlers still take swipes. */}
          <div
            className={[
              'relative flex h-56 w-full select-none items-center justify-center overflow-hidden rounded-xl border border-line-subtle bg-white p-2 sm:h-72',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 dark:bg-subtle',
              many ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : '',
            ].join(' ')}
            style={{ touchAction: 'pan-y' }}
            onPointerDown={onSwipeStart}
            onPointerMove={onSwipeMove}
            onPointerUp={onSwipeEnd}
            onPointerCancel={onSwipeCancel}
            tabIndex={many ? 0 : -1}
            role={many ? 'group' : undefined}
            aria-label={many ? `Photo ${safeIndex + 1} of ${images.length} — swipe or use the left and right arrow keys` : undefined}
            onKeyDown={onGalleryKeyDown}
          >
            <div
              className={[
                'flex h-full w-full',
                dragging ? '' : 'transition-transform duration-300 ease-out',
              ].join(' ')}
              style={{ transform: `translateX(calc(${-safeIndex * 100}% + ${drag}px))` }}
            >
              {(many ? images : [images[0]]).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${src}-${i}`}
                  src={src}
                  alt={many ? `${p.name} — photo ${i + 1} of ${images.length}` : p.name}
                  draggable={false}
                  className="pointer-events-none h-full w-full shrink-0 object-contain"
                  onError={(e) => {
                    e.currentTarget.src = PLACEHOLDER
                  }}
                />
              ))}
            </div>
            {many && (
              <span className="absolute right-2 top-2 rounded-full bg-fg/70 px-2 py-0.5 text-[10px] font-semibold text-on-accent tabular-nums">
                {safeIndex + 1}/{images.length}
              </span>
            )}
          </div>

          {many && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  onClick={() => goTo(i)}
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
              <button
                type="button"
                onClick={() => {
                  setViewOpen(false)
                  router.push(`/exhibition/vendor/${p.vendor_id}`)
                }}
                className="mt-1 inline-flex items-center gap-1 text-chips font-semibold text-brand transition-colors hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <Store className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden="true" />
                Visit {p.vendor_name}&rsquo;s stand
              </button>
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
            {!!p.category_name && (
              <span className="rounded-full bg-subtle px-1.5 py-0.5 font-medium text-muted">{p.category_name}</span>
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
