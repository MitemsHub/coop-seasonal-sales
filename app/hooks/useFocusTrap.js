'use client'

// app/hooks/useFocusTrap.js
// Shared focus management for drawers, dialogs and modals. One place for the
// interaction pattern used across the app:
//  - move focus into the panel on open
//  - restore focus to the trigger (or the previously focused element) on close,
//    guarded so a fresh page load never steals focus
//  - trap Tab inside the panel (wrap at first/last, pull back in if it escapes)
//  - ESC closes (when onClose is provided)
//  - optional body scroll lock
//  - optional breakpoint release (close when the viewport crosses a width)
//
// `panelRef` must point at the focusable container (tabIndex={-1}), `triggerRef`
// at the control that opened the surface (restore target). For modals there is
// usually no trigger — pass `breakpoint={null}` and the previous element is used.

import { useEffect, useRef, useState } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function useFocusTrap({
  open,
  panelRef,
  triggerRef,
  breakpoint = 1024,
  lockScroll = false,
  onClose,
}) {
  const hasOpenedRef = useRef(false)
  const lastFocusedRef = useRef(null)
  // Keep the latest callback without re-running the effects on every render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Open: remember where focus came from, then move it into the panel.
  useEffect(() => {
    if (!open) return
    hasOpenedRef.current = true
    lastFocusedRef.current = document.activeElement
    const t = setTimeout(() => {
      const panel = panelRef.current
      if (panel && !panel.contains(document.activeElement)) panel.focus()
    }, 60)
    return () => clearTimeout(t)
  }, [open, panelRef])

  // Close: hand focus back to the trigger (or the element that opened the surface).
  // Skipped until the surface has actually been opened, so page loads never steal focus.
  useEffect(() => {
    if (open || !hasOpenedRef.current) return
    const t = setTimeout(() => {
      const target = triggerRef?.current ?? lastFocusedRef.current
      target?.focus?.()
    }, 320)
    return () => clearTimeout(t)
  }, [open, panelRef, triggerRef])

  // While open: ESC, Tab trap, scroll lock, breakpoint release.
  useEffect(() => {
    if (!open) return
    const mq = breakpoint ? window.matchMedia(`(min-width: ${breakpoint}px)`) : null
    const panel = panelRef.current
    const prevOverflow = document.body.style.overflow

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const focusables = [...panel.querySelectorAll(FOCUSABLE)]
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      // Focus escaped the panel — pull it back to the first control.
      if (!panel.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
        return
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    const onMq = () => {
      if (mq.matches) onCloseRef.current?.()
    }

    if (lockScroll) document.body.style.overflow = 'hidden'
    mq?.addEventListener('change', onMq)
    if (mq?.matches) {
      // Opened at/above the breakpoint — release immediately.
      onCloseRef.current?.()
    } else {
      window.addEventListener('keydown', onKeyDown, true)
    }
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      mq?.removeEventListener('change', onMq)
      if (lockScroll) document.body.style.overflow = prevOverflow
    }
  }, [open, panelRef, breakpoint, lockScroll])

  return null
}

// True while the viewport is below `breakpoint` — used to make off-canvas
// surfaces inert on mobile (removed from tab order and the accessibility tree).
export function useIsMobileView(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpoint])
  return isMobile
}
