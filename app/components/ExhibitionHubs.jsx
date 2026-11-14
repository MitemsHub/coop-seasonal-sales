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
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

const GAP = 12 // gap-3 between slides
const CLONE_LIMIT = 5 // first N cards cloned onto the end for a seamless loop

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return 'ST'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

function StandCard({ v, count }) {
  const router = useRouter()
  return (
    <button
      type="button"
      data-hub-card
      onClick={() => router.push(`/exhibition/vendor/${v.id}`)}
      aria-label={`Open ${v.name} stand`}
      className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface p-3 text-left transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span className="flex w-full min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-[11px] font-bold text-accent-fg transition-colors duration-200 ease-sakani group-hover:bg-accent/25">
          {initials(v.name)}
        </span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-subtext transition-transform duration-200 ease-sakani group-hover:translate-x-0.5 group-hover:text-accent" />
      </span>
      <span className="mt-2 block truncate text-xs font-semibold text-fg sm:text-sm">{v.name}</span>
      <span className="mt-0.5 block truncate text-chips text-muted">
        {v.address || 'Exhibition stand'}
      </span>
      <span className="mt-2 text-chips font-medium text-accent">
        {count} product{count === 1 ? '' : 's'}
      </span>
    </button>
  )
}

export default function ExhibitionHubs({ vendors = [], vendorCounts = {} }) {
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
        className="scrollbar-hide -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-1"
      >
        {slides.map((v, idx) => (
          <div
            key={`${v.id}-${idx}`}
            aria-hidden={idx >= count}
            className={`${slideWidth} shrink-0 snap-start`}
          >
            <StandCard v={v} count={vendorCounts[v.id] || 0} />
          </div>
        ))}
      </div>
    </section>
  )
}
