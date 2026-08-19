'use client'

// app/components/ui/BreadcrumbHint.jsx
// First-run onboarding hint for the staff portals: a tiny toast floats under the
// top-bar breadcrumb trail so new admins/reps notice it's clickable.
//
// Behaviour:
//   - Shows on the first `maxVisits` browser sessions (counted in localStorage
//     per portal), then never again.
//   - Within those sessions it re-appears on every route change (fades back in)
//     so the hint is seen on each page, and auto-hides after `autoHideMs`.
//   - Dismissing it (X) hides it for the rest of the session.
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronUp, X } from 'lucide-react'

export default function BreadcrumbHint({
  portal = 'admin',
  maxVisits = 3,
  autoHideMs = 8000,
  label = 'Tip: the trail above is clickable. Tap any step to jump back',
}) {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const decidedRef = useRef(false)
  const enabledRef = useRef(null) // null = undecided, true/false = show ever?
  const dismissedRef = useRef(false)

  useEffect(() => {
    // Decide once per session whether this portal still gets the hint.
    if (!decidedRef.current) {
      decidedRef.current = true
      const KEY = `breadcrumbHint:${portal}`
      let visits = 0
      try {
        visits = Number(localStorage.getItem(KEY) || 0)
      } catch {
        /* private mode — ignore, show the hint */
      }
      if (visits >= maxVisits) {
        enabledRef.current = false
        return
      }
      enabledRef.current = true
      try {
        localStorage.setItem(KEY, String(visits + 1))
      } catch {
        /* ignore */
      }
    }

    // Re-show on first paint and on every route change (until dismissed).
    if (enabledRef.current !== true || dismissedRef.current) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), autoHideMs)
    return () => clearTimeout(t)
  }, [pathname, portal, maxVisits, autoHideMs])

  const dismiss = () => {
    dismissedRef.current = true
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <div className="pointer-events-none fixed inset-x-0 top-[70px] z-[110] flex justify-center px-3">
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.33, 1, 0.68, 1] }}
            role="status"
            className="pointer-events-auto flex max-w-[min(92vw,440px)] items-center gap-2 rounded-full border border-line bg-surface py-2 pl-3 pr-1.5 text-chips font-medium text-muted shadow-lg shadow-black/5 ring-1 ring-brand/20 sm:text-caption"
          >
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.5} aria-hidden="true" />
            <span className="min-w-0 truncate">{label}</span>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss tip"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-subtext transition-colors duration-150 hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
