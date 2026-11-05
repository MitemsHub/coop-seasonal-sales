'use client'

// app/components/CycleTag.jsx
// "Which cycle am I on" — a small pill in every top bar showing the season the
// current page acts on. The module follows the route, because a single tag
// can't honestly show the food and exhibition cycles at once:
//   /exhibition, /vendor, /rep/exhibition, /admin/exhibition -> exhibition
//   /ram, /rep/ram, /admin/ram                               -> ram
//   everything else                                          -> food
// The endpoint returns all three in one call and the result is cached for the
// life of the tab, so navigating between pages costs nothing.
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { CalendarDays } from 'lucide-react'

let cache = null
let inflight = null

function load() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetch('/api/cycle/tag', { cache: 'no-store' })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (j?.ok) cache = j.cycles || {}
        return cache || {}
      })
      .catch(() => ({}))
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

function moduleFor(pathname) {
  const p = String(pathname || '')
  if (p.startsWith('/vendor') || p.includes('/exhibition')) return 'exhibition'
  if (p.includes('/ram')) return 'ram'
  return 'food'
}

const MODULE_LABEL = { food: 'Food', ram: 'Ram', exhibition: 'Exhibition' }

export default function CycleTag({ className = '' }) {
  const pathname = usePathname()
  const [cycles, setCycles] = useState(cache)

  useEffect(() => {
    let alive = true
    load().then((c) => {
      if (alive) setCycles(c)
    })
    return () => {
      alive = false
    }
  }, [])

  const module = moduleFor(pathname)
  const cycle = cycles?.[module]
  if (!cycle?.name) return null

  const open = cycle.open !== false
  const label = `${MODULE_LABEL[module]} cycle: ${cycle.name}${open ? '' : ' (closed)'}`

  return (
    <span
      title={label}
      aria-label={label}
      className={[
        'inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] leading-none',
        className,
      ].join(' ')}
    >
      <span
        className={['h-1.5 w-1.5 shrink-0 rounded-full', open ? 'bg-success-fg' : 'bg-warning'].join(' ')}
        aria-hidden="true"
      />
      <CalendarDays className="hidden h-3 w-3 shrink-0 text-muted sm:block" strokeWidth={2.2} aria-hidden="true" />
      <span className="hidden shrink-0 text-subtext sm:inline">Cycle</span>
      <span className="max-w-[7rem] truncate font-semibold text-fg sm:max-w-[16rem]">{cycle.name}</span>
    </span>
  )
}
