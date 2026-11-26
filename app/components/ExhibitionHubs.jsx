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
import StandCard from './StandCard'

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
