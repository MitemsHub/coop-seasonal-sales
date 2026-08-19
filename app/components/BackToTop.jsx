// app/components/BackToTop.jsx
// Floating "Back to top" button for every signed-in role (member, rep, admin,
// vendor). Appears after the user scrolls down a long page and smooth-scrolls
// back to the top on click. Guests on the landing page never see it.
//
// Two scroll models exist across the app: the member portal scrolls the window,
// while the admin/rep/vendor shells use an inner overflow container
// (`h-screen overflow-hidden` + `overflow-y-auto` main). The button listens in
// the capture phase and tracks whichever element actually scrolls, so it works
// on every surface.
//
// It also watches for the app's cart bars (tagged with `data-cart-bar` in
// CartStickyBar) and lifts itself above whichever one is present — the fixed
// food/exhibition strip and the ram summary card — so it never covers the
// "Go to Cart" action.
'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const SHOW_AFTER = 400 // px of vertical scroll before the button appears
const BAR_CLEARANCE = 92 // bottom offset that clears the compact bar / ram summary card
const BASE_OFFSET = 20

export default function BackToTop() {
  const { user } = useAuth()
  const [visible, setVisible] = useState(false)
  const [raised, setRaised] = useState(false)
  // The element that actually scrolls — window on member pages, the portal's
  // inner overflow container on admin/rep/vendor pages.
  const scrollerRef = useRef(null)

  useEffect(() => {
    let raf = 0

    const readTop = (el) => {
      if (!el) return window.scrollY || document.documentElement.scrollTop || 0
      return el.scrollTop || 0
    }

    const update = (el) => {
      // Remember the real scroll container (ignore the document/window targets).
      if (
        el &&
        el !== document &&
        el !== document.documentElement &&
        el !== document.body &&
        typeof el.scrollTop === 'number'
      ) {
        scrollerRef.current = el
      }
      setVisible(readTop(scrollerRef.current) > SHOW_AFTER)
      setRaised(!!document.querySelector('[data-cart-bar]'))
      raf = 0
    }

    // Capture-phase scroll listener catches the inner containers too (scroll
    // events don't bubble, but they do pass through document capture).
    const onScrollCapture = (e) => {
      if (!raf) raf = requestAnimationFrame(() => update(e.target))
    }
    update(document)
    window.addEventListener('scroll', onScrollCapture, { capture: true, passive: true })
    window.addEventListener('resize', onScrollCapture)
    // Re-check shortly after mount in case the cart bar hydrates late.
    const t = setTimeout(() => update(document), 600)
    return () => {
      window.removeEventListener('scroll', onScrollCapture, { capture: true })
      window.removeEventListener('resize', onScrollCapture)
      clearTimeout(t)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  if (!user) return null

  const scrollToTop = () => {
    const el = scrollerRef.current || document.scrollingElement || document.documentElement
    const start = el.scrollTop || 0
    if (start === 0) return
    try {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      el.scrollTop = 0
      return
    }
    // Some webviews silently drop smooth scrolling on nested overflow
    // containers (the window variant is fine) — if nothing has moved shortly
    // after, jump straight to the top so the action never appears dead.
    if (el.scrollTop === start) {
      window.setTimeout(() => {
        if (el.scrollTop === start) el.scrollTop = 0
      }, 350)
    }
  }

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      title="Back to top"
      className={[
        'fixed right-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand text-on-accent shadow-lg shadow-brand/30 ring-1 ring-brand/25 transition-all duration-300 hover:bg-brand-active hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:right-6',
        raised ? 'bottom-[92px]' : 'bottom-5',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      ].join(' ')}
    >
      <ArrowUp className="h-5 w-5" strokeWidth={2.4} />
    </button>
  )
}
