'use client'

// app/components/ExhibitionHubs.jsx
// Hub-browsing surface for the member exhibition shop. A branch can host
// 100+ stands, so a flat card wall is unusable. Instead:
//   - An auto-rotating slideshow with NO visible controls: it advances by
//     itself every few seconds, showing 2 stands per view on phones, 3 on
//     tablets, 4 on laptop and 5 on desktop. It pauses while hovered, touched
//     or keyboard-focused (so the card under your finger never runs away),
//     respects prefers-reduced-motion, and loops seamlessly forever — the
//     first cards are cloned onto the end of the track so the wrap is
//     invisible.
//   - "View all" jumps to /exhibition/all — the full catalog page where every
//     stand's products are browsable and buyable in one place.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, LayoutGrid, Store } from 'lucide-react'

const GAP = 12 // gap-3 between slides
const CLONE_LIMIT = 5 // first N cards cloned onto the end for a seamless loop

function HubCard({ v, count }) {
  const router = useRouter()
  return (
    <button
      type="button"
      data-hub-card
      onClick={() => router.push(`/exhibition/vendor/${v.id}`)}
      aria-label={`Open ${v.name} hub`}
      className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface p-3 text-left transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span className="flex w-full min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-fg transition-colors duration-200 ease-sakani group-hover:bg-accent/25">
          <Store className="h-4 w-4" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-fg sm:text-sm">{v.name}</span>
          {v.address ? (
            <span className="block truncate text-chips text-muted">{v.address}</span>
          ) : null}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-subtext transition-transform duration-200 ease-sakani group-hover:translate-x-0.5 group-hover:text-accent" />
      </span>
      <span className="mt-2.5 text-chips font-medium text-accent">
        {count} product{count === 1 ? '' : 's'}
      </span>
    </button>
  )
}

export default function ExhibitionHubs({ vendors = [], vendorCounts = {} }) {
  const router = useRouter()
  const trackRef = useRef(null)
  const resumeTimer = useRef(null)
  const pauseRef = useRef(false)
  const countRef = useRef(0)
  const [paused, setPaused] = useState(false)

  const count = vendors.length

  useEffect(() => {
    pauseRef.current = paused
  }, [paused])

  useEffect(() => {
    countRef.current = vendors.length
  }, [vendors.length])

  const resumeAfter = (ms) => {
    clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => setPaused(false), ms)
  }

  // Auto-rotate — no arrows/dots: the track advances one full viewport at a
  // time and never stops. The first cards are cloned onto the end of the
  // track; when the smooth scroll reaches that clone region — which is
  // pixel-identical to the start — the position teleports back to 0
  // invisibly, so the loop has no hold, no rewind, no visible jump. It
  // pauses whenever the pointer, a finger, or keyboard focus is on the
  // carousel, and never runs when the user prefers reduced motion. Mobile
  // gets a longer interval (carousels should move slower on small screens).
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const intervalMs = (window.innerWidth || 0) < 768 ? 5200 : 4200
    const id = setInterval(() => {
      const track = trackRef.current
      if (!track || pauseRef.current) return
      const card = track.querySelector('[data-hub-card]')
      if (!card) return
      const step = card.offsetWidth + GAP
      const perView = Math.max(1, Math.round(track.clientWidth / step))
      if (countRef.current <= perView) return // everything already fits on screen
      const max = track.scrollWidth - track.clientWidth
      if (max <= 1) return
      // Seamless wrap — we've scrolled into the cloned region, whose cards are
      // identical to the start, so snapping to 0 is invisible to the eye.
      if (track.scrollLeft >= max - 0.5) {
        track.scrollLeft = 0
      }
      track.scrollTo({ left: Math.min(max, track.scrollLeft + step * perView), behavior: 'smooth' })
    }, intervalMs)
    return () => {
      clearInterval(id)
      clearTimeout(resumeTimer.current)
    }
  }, [])

  if (count === 0) return null

  return (
    <section
      aria-label="Browse all vendor hubs"
      className="mb-6"
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => resumeAfter(250)}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-chips font-medium uppercase tracking-wider text-muted">
          <Store className="h-3 w-3" strokeWidth={2.2} />
          Browse all hubs
        </span>
        <span className="flex items-center gap-2">
          <span className="text-chips text-muted">
            {count.toLocaleString()} stand{count === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={() => router.push('/exhibition/all')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-chips font-semibold text-fg transition-colors duration-200 ease-sakani hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            View all
          </button>
        </span>
      </div>

      {/* Auto-rotating slideshow — 2 stands per view on phones, 3 on
          tablets, 4 on laptop, 5 on desktop. It changes by itself, loops
          seamlessly forever (first cards are cloned onto the end), and
          pauses under a cursor, finger or keyboard focus. Swiping still
          works for manual browsing. */}
      <div
        ref={trackRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => resumeAfter(0)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => resumeAfter(1800)}
        className="scrollbar-hide -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-1"
      >
        {[...vendors, ...vendors.slice(0, Math.min(CLONE_LIMIT, vendors.length))].map((v, idx) => (
          <div
            key={`${v.id}-${idx}`}
            aria-hidden={idx >= vendors.length}
            className="w-[calc(50%-6px)] shrink-0 snap-start sm:w-[calc(33.333%-8px)] lg:w-[calc(25%-9px)] xl:w-[calc(20%-9.6px)]"
          >
            <HubCard v={v} count={vendorCounts[v.id] || 0} />
          </div>
        ))}
      </div>
    </section>
  )
}
