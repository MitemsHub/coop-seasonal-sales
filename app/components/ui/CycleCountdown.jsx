// app/components/ui/CycleCountdown.jsx
// UI-kit countdown chip for a live season — "closes in N days" / "closes
// tomorrow" / "closes today". One component renders the identical closing-date
// treatment across every surface (the My Coop module cards, the admin
// dashboard module switcher, the rep access cards), so the countdown can never
// drift between modules or portals.
//
// Props:
//   endsAt   — ISO close date; no chip renders without one
//   prefix   — optional leading label before the countdown (e.g. the cycle
//              name: "Exhibition 2026 · closes in 28 days")
//   noun     — tooltip wording ("Cycle" vs "Season")
//   variant  — 'default': standalone chip (subtle pill with its own
//              background); 'bare': transparent inline label that inherits the
//              parent's colors, for embedding inside tabs/pills
//   className— extra classes (margin etc.)
'use client'

import { Calendar } from 'lucide-react'

// Whole days until a season closes — clamped at 0 so a past date reads
// "closes today" rather than a negative count.  Ceil of the exact remaining
// time, so with an end-of-day ends_at it counts the closing day itself:
// viewing on the 27th for a close on the 31st reads 5 days left, matching
// how the admin pages and humans count the same date range.
function daysUntil(iso) {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 86400000))
}

// True when the close DATE — in the viewer's local time — is today, even if
// hours remain.  The final day must read "closes today", never "closes
// tomorrow" (a ceil of a sub-24h remainder would say tomorrow).
function closesOnLocalDate(iso) {
  const end = new Date(iso)
  const now = new Date()
  return (
    end.getFullYear() === now.getFullYear() &&
    end.getMonth() === now.getMonth() &&
    end.getDate() === now.getDate()
  )
}

export default function CycleCountdown({ endsAt, noun = 'Season', prefix, variant = 'default', className = '' }) {
  const days = daysUntil(endsAt)
  if (days == null) return null
  const label =
    days <= 0 || closesOnLocalDate(endsAt)
      ? 'closes today'
      : days === 1
        ? 'closes tomorrow'
        : `closes in ${days} days`
  const title = `${noun} closes ${new Date(endsAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`
  const wrapCls =
    variant === 'bare'
      ? `inline-flex items-center gap-1.5 ${className}`
      : `mt-2.5 flex w-fit items-center gap-1.5 rounded-md bg-subtle px-2 py-1 text-[11px] font-medium text-muted ${className}`
  return (
    <span title={title} className={wrapCls}>
      <Calendar
        className={variant === 'bare' ? 'h-3 w-3 text-current' : 'h-3 w-3 text-brand'}
        strokeWidth={2.2}
        aria-hidden="true"
      />
      {prefix != null && <>{prefix} · </>}
      {label}
    </span>
  )
}
