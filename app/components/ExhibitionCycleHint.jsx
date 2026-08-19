// app/components/ExhibitionCycleHint.jsx
// Live, cycle-aware timing hint for the Coop Exhibition surfaces.
//  - future starts_at  → "Opens in Xd Yh Zm" countdown (ticking)
//  - active + ends_at  → "Open until {date} · Xd Yh Zm left"
//  - no usable dates   → renders nothing (callers fall back to static copy)
// The countdown only appears after mount (a now=0 pre-mount render shows the
// static date text), so server and client hydration never disagree.
'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Clock } from 'lucide-react'

function useMountedNow(intervalMs = 60_000) {
  const [now, setNow] = useState(0) // 0 = not mounted yet
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function countdownParts(targetMs, now) {
  const ms = Math.max(0, targetMs - now)
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.max(0, Math.floor((ms % 3_600_000) / 60_000))
  return { d, h, m }
}

const fmtCountdown = ({ d, h, m }) =>
  d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`

const fmtShortDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function ExhibitionCycleHint({ cycle, className = '' }) {
  const now = useMountedNow()
  const startsAt = cycle?.starts_at ? new Date(cycle.starts_at).getTime() : null
  const endsAt = cycle?.ends_at ? new Date(cycle.ends_at).getTime() : null
  const liveNow = now || Date.now() // static-date fallback pre-mount (hydration-safe)

  const opensSoon = startsAt != null && startsAt > liveNow
  const openUntil = cycle?.status === 'active' && endsAt != null && endsAt > liveNow

  const cls = ['inline-flex items-center gap-1.5 font-semibold text-brand', className].join(' ')

  if (opensSoon) {
    return (
      <span className={cls}>
        <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
        {now ? (
          <>
            Opens in <strong className="tabular-nums">{fmtCountdown(countdownParts(startsAt, liveNow))}</strong>
          </>
        ) : (
          'Opening soon'
        )}
      </span>
    )
  }

  if (openUntil) {
    return (
      <span className={cls}>
        <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
        {now ? (
          <>
            Open until {fmtShortDate(cycle.ends_at)} ·{' '}
            <strong className="tabular-nums">{fmtCountdown(countdownParts(endsAt, liveNow))}</strong> left
          </>
        ) : (
          <>Open until {fmtShortDate(cycle.ends_at)}</>
        )}
      </span>
    )
  }

  return null
}
