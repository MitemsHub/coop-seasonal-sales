'use client'

// app/components/ExhibitionHubs.jsx
// The exhibition home's "Featured stands" rail. Every stand with products is in
// the rail and the rail slides through them by itself — 2 cards per view on
// phones, 3 on tablets, 4 on laptop, 5 on desktop — so a market with 100 stands
// is never a static row of three.
//
// Behaviour:
//   - Advances one viewport at a time, pauses under a cursor/finger/keyboard
//     focus, respects prefers-reduced-motion, and does nothing when the whole
//     list already fits on screen.
//   - First cards are cloned onto the end only when the track actually
//     overflows, so the wrap is seamless without ever drawing a stand twice.
//   - Swiping still works; the auto-advance simply resumes after a moment.
//
// The card is a shopfront, not a link with a banner: a coloured stand header
// with the vendor's monogram, their name and what they sell (their declared
// category), their one-line pitch, a strip of the products actually on the
// stand, and the stand number. Vendors without a banner still get a distinctive
// header — the colour is derived from their name — so no stand looks unfinished.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { initials } from '../../lib/exhibitionStands'
import { vendorAboutLine, vendorShelfLabels } from '../../lib/exhibitionShelf'

const GAP = 12 // gap-3 between slides
const CLONE_LIMIT = 5 // first N cards cloned onto the end for a seamless loop
const PLACEHOLDER = '/images/items/placeholder.svg'
const THUMBS = 3

// A stable colour per business, so a stand without a banner still has its own
// identity in the rail rather than the same grey-green wash as every other.
function hueOf(name) {
  let h = 0
  const s = String(name || '')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

function StandCard({ v, count, products = [], shelfLabels, index = 0 }) {
  const router = useRouter()
  // Up to three shelves, best first. The caller supplies labels already ordered
  // by how many of the stand's products land on each, so a wig stand reads
  // "Hair & Wigs" before it reads "Fashion".
  const labels = (shelfLabels?.length ? shelfLabels : vendorShelfLabels(v)).slice(0, 3)
  const about = vendorAboutLine(v)
  const hue = hueOf(v.name)
  const thumbs = products.filter((p) => p.image_url || p.images?.length).slice(0, THUMBS)

  return (
    <button
      type="button"
      data-hub-card
      onClick={() => router.push(`/exhibition/vendor/${v.id}`)}
      aria-label={`Open ${v.name} stand — ${count} product${count === 1 ? '' : 's'}`}
      style={{ animationDelay: `${Math.min(index, 7) * 55}ms` }}
      // No hover lift here: the rail is an overflow-x scroller, so a card that
      // moves up has its top edge and shadow clipped by the scroll box. The
      // hover reads through the border, shadow and the banner zoom instead.
      className="rise-in group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-sm transition-[border-color,box-shadow] duration-300 ease-sakani hover:border-accent hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {/* Stand header — banner, or a colour drawn from the vendor's name */}
      <span className="relative block h-20 w-full overflow-hidden">
        {v.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.banner_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-sakani group-hover:scale-110"
          />
        ) : (
          <>
            <span
              className="absolute inset-0"
              aria-hidden="true"
              style={{
                background: `linear-gradient(125deg, hsl(${hue} 45% 92%), hsl(${(hue + 38) % 360} 42% 73%))`,
              }}
            />
            <span
              className="absolute inset-0 opacity-20"
              aria-hidden="true"
              style={{
                backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
                backgroundSize: '11px 11px',
                color: '#0f172a',
              }}
            />
            <span
              className="absolute -bottom-6 right-1 select-none text-[4.75rem] font-black leading-none tracking-tighter text-white/55 transition-transform duration-500 ease-sakani group-hover:scale-105"
              aria-hidden="true"
            >
              {initials(v.name)}
            </span>
          </>
        )}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-fg/25 via-transparent to-transparent" aria-hidden="true" />
        {/* Sheen — the small sign of life a static tile does not have. */}
        <span
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/30 blur-md transition-transform duration-700 ease-sakani group-hover:translate-x-[420%]"
          aria-hidden="true"
        />
        {!!v.stand_number && (
          <span className="absolute right-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fg shadow-sm backdrop-blur">
            Stand {v.stand_number}
          </span>
        )}
      </span>

      {/* Monogram + product count, overlapping the header */}
      <span className="relative -mt-5 flex items-end px-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-surface bg-surface text-[11px] font-black text-brand shadow-sm ring-1 ring-line-subtle transition-colors duration-300 group-hover:bg-accent-subtle group-hover:text-accent">
          {initials(v.name)}
        </span>
        <span className="ml-auto mb-1 inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-accent">
          {count} product{count === 1 ? '' : 's'}
        </span>
      </span>

      <span className="flex flex-1 flex-col px-3 pb-3 pt-2">
        <span className="block truncate text-sm font-bold tracking-tight text-fg">{v.name}</span>
        <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-wide text-brand">
          {labels.join(' · ') || 'Exhibition stand'}
        </span>
        <span className="mt-1 line-clamp-2 min-h-[2.2rem] break-words text-[11px] leading-snug text-muted">
          {about || v.address || 'A stand at this season’s exhibition.'}
        </span>

        {thumbs.length > 0 && (
          <span className="mt-2 flex items-center gap-1">
            {thumbs.map((p) => (
              <span
                key={p.id}
                className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-line-subtle bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.image_url || p.images?.[0] || PLACEHOLDER}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 ease-sakani group-hover:scale-105"
                  onError={(e) => { e.currentTarget.src = PLACEHOLDER }}
                />
              </span>
            ))}
            {count > thumbs.length && (
              <span className="pl-0.5 text-[10px] font-semibold text-muted">+{count - thumbs.length}</span>
            )}
          </span>
        )}

        <span className="mt-auto flex items-center justify-between gap-2 border-t border-line-subtle pt-2">
          <span className="truncate text-[10px] text-muted">{v.hall || v.address || 'Exhibition stand'}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-brand">
            Visit
            <ChevronRight className="h-3 w-3 transition-transform duration-300 ease-sakani group-hover:translate-x-0.5" />
          </span>
        </span>
      </span>
    </button>
  )
}

export default function ExhibitionHubs({ vendors = [], vendorCounts = {}, productsByVendor = {}, shelfLabelsByVendor = {} }) {
  const trackRef = useRef(null)
  const resumeTimer = useRef(null)
  const pauseRef = useRef(false)
  const countRef = useRef(0)
  const stuckRef = useRef({ lastLeft: -1, armed: false })
  const [paused, setPaused] = useState(false)
  const [needsClones, setNeedsClones] = useState(false)

  const count = vendors.length

  useEffect(() => {
    pauseRef.current = paused
  }, [paused])

  useEffect(() => {
    countRef.current = count
  }, [count])

  // Clones exist only to hide the wrap point on a track that overflows.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const measure = () => {
      const card = track.querySelector('[data-hub-card]')
      if (!card) return
      const step = card.offsetWidth + GAP
      const perView = Math.max(1, Math.round(track.clientWidth / step))
      setNeedsClones(count > perView)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(track)
    return () => ro?.disconnect()
  }, [count])

  const clones = needsClones ? vendors.slice(0, Math.min(CLONE_LIMIT, count)) : []
  const slides = clones.length ? [...vendors, ...clones] : vendors

  const resumeAfter = (ms) => {
    clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => setPaused(false), ms)
  }

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const intervalMs = (window.innerWidth || 0) < 768 ? 5200 : 4200
    const id = setInterval(() => {
      const track = trackRef.current
      if (!track || pauseRef.current) {
        stuckRef.current.armed = false
        return
      }
      if (document.hidden) {
        stuckRef.current.armed = false
        return
      }
      const card = track.querySelector('[data-hub-card]')
      if (!card) return
      const step = card.offsetWidth + GAP
      const perView = Math.max(1, Math.round(track.clientWidth / step))
      if (countRef.current <= perView) return // everything already fits
      const max = track.scrollWidth - track.clientWidth
      if (max <= 1) return
      // A frozen smooth scroll (backgrounded tab, forced re-snap) would leave
      // the rail sitting still; if a tick produced no movement, advance
      // instantly for that tick so the slideshow never stalls.
      const stuck = stuckRef.current
      const raw = track.scrollLeft
      if (stuck.armed && Math.abs(raw - stuck.lastLeft) < 1) {
        const atEnd = raw >= max - 0.5
        if (atEnd) track.scrollLeft = 0
        track.scrollTo({ left: Math.min(max, (atEnd ? 0 : raw) + step * perView), behavior: 'auto' })
        stuck.armed = false
        stuck.lastLeft = track.scrollLeft
        return
      }
      stuck.lastLeft = raw
      const atEnd = raw >= max - 0.5
      if (atEnd) {
        track.scrollLeft = 0
      }
      track.scrollTo({ left: Math.min(max, (atEnd ? 0 : track.scrollLeft) + step * perView), behavior: 'smooth' })
      stuck.armed = true
    }, intervalMs)
    return () => {
      clearInterval(id)
      clearTimeout(resumeTimer.current)
    }
  }, [])

  if (count === 0) return null

  // A market with one or two stands shouldn't leave a mostly empty row: give
  // each card a sensible share of the width until there are enough to slide.
  const slideWidth =
    count === 1
      ? 'w-full sm:w-[calc(50%-6px)] lg:w-[calc(33.333%-8px)]'
      : count <= 3
        ? 'w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)] lg:w-[calc(25%-9px)]'
        : 'w-[calc(50%-6px)] sm:w-[calc(33.333%-8px)] lg:w-[calc(25%-9px)] xl:w-[calc(20%-9.6px)]'

  return (
    <section aria-label="Featured stands" className="mb-6">
      <div
        ref={trackRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => resumeAfter(0)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => resumeAfter(1800)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => resumeAfter(250)}
        className="scrollbar-hide -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 py-1"
      >
        {slides.map((v, idx) => (
          <div
            key={`${v.id}-${idx}`}
            aria-hidden={idx >= count}
            className={`${slideWidth} shrink-0 snap-start`}
          >
            <StandCard
              v={v}
              count={vendorCounts[v.id] || 0}
              products={productsByVendor[v.id] || []}
              shelfLabels={shelfLabelsByVendor[v.id]}
              index={idx}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
