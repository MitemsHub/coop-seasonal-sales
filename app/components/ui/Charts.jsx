'use client'

// app/components/ui/Charts.jsx
// Sakani charts — theme-aware via the --chart-* tokens (light + dark flip in globals.css).
// BarChart: stacked/grouped bars from { label, [seriesKey]: value } rows.
// LineChart: smooth area line from { label, value } rows.
// Both are pure SVG + div overlays — no chart library.

import { useId, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

export function ChartEmpty({ empty = 'No data to chart yet', height }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl bg-subtle/60 text-sm text-muted"
      style={{ height }}
    >
      {empty}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   BarChart
   ═══════════════════════════════════════════════════════════════════ */
export function BarChart({
  data = [],
  series = [],
  height = 240,
  formatValue = (v) => v,
  empty = 'No data yet',
  className = '',
}) {
  const [active, setActive] = useState(null)

  const rows = useMemo(() => {
    const totals = data.map((d) => series.reduce((s, se) => s + (Number(d[se.key]) || 0), 0))
    const max = Math.max(1, ...totals) * 1.12
    return { totals, max }
  }, [data, series])

  if (!data.length || !series.length) return <ChartEmpty empty={empty} height={height} />

  return (
    <div className={className} role="img" aria-label="Bar chart">
      <div className="relative" style={{ height }}>
        {/* Gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <div
            key={f}
            className="absolute inset-x-0 border-t border-line-subtle"
            style={{ bottom: `${f * 100}%` }}
            aria-hidden="true"
          />
        ))}

        {/* Bars */}
        <div className="absolute inset-0 flex items-end justify-around gap-2 px-2">
          {data.map((d, i) => (
            <div
              key={d.label}
              className="group relative flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <div
                className="flex w-full max-w-10 flex-col justify-end gap-px transition-[background-color] duration-200"
                style={{ height: `${(rows.totals[i] / rows.max) * 100}%` }}
              >
                {series.map((s, si) => {
                  const v = Number(d[s.key]) || 0
                  const pct = (v / Math.max(rows.totals[i], 1)) * 100
                  return (
                    <motion.div
                      key={s.key}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.5, ease: 'easeOut', delay: i * 0.05 + si * 0.04 }}
                      style={{
                        transformOrigin: 'bottom',
                        height: `${pct}%`,
                        backgroundColor: s.color || PALETTE[si % PALETTE.length],
                        borderRadius: si === 0 ? '3px 3px 0 0' : 0,
                        opacity: active === null || active === i ? 1 : 0.35,
                      }}
                      className="w-full transition-opacity duration-200"
                    />
                  )
                })}
              </div>

              {/* Tooltip */}
              {active === i && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 min-w-32 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 shadow-lg">
                  <p className="whitespace-nowrap text-xs font-semibold text-fg">{d.label}</p>
                  <div className="mt-1.5 space-y-1">
                    {series.map((s, si) => (
                      <p key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-chips text-muted">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: s.color || PALETTE[si % PALETTE.length] }}
                        />
                        {s.label || s.key}: {formatValue(Number(d[s.key]) || 0)}
                      </p>
                    ))}
                  </div>
                  <p className="mt-1.5 whitespace-nowrap border-t border-line pt-1.5 text-xs font-semibold text-fg">
                    Total: {formatValue(rows.totals[i])}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* X labels */}
      <div className="mt-2 flex gap-2 px-2">
        {data.map((d) => (
          <div key={d.label} className="flex-1 truncate text-center text-chips text-muted" title={d.label}>
            {d.label}
          </div>
        ))}
      </div>

      {/* Legend */}
      {series.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((s, si) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-chips text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color || PALETTE[si % PALETTE.length] }} />
              {s.label || s.key}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   LineChart
   ═══════════════════════════════════════════════════════════════════ */
export function LineChart({
  data = [],
  height = 240,
  color = 'var(--chart-1)',
  formatValue = (v) => v,
  empty = 'No data yet',
  fill = true,
  className = '',
}) {
  const wrapRef = useRef(null)
  const [active, setActive] = useState(null)
  const gradId = useId().replace(/:/g, '')

  const { pts, max } = useMemo(() => {
    const maxVal = Math.max(1, ...data.map((d) => Number(d.value) || 0)) * 1.15
    const W = 100
    const step = data.length > 1 ? W / (data.length - 1) : 0
    const pts = data.map((d, i) => ({
      x: data.length > 1 ? i * step : W / 2,
      y: 100 - ((Number(d.value) || 0) / maxVal) * 90 - 5,
    }))
    return { pts, max: maxVal }
  }, [data])

  const linePath = useMemo(() => {
    if (!pts.length) return ''
    if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`
    return pts.reduce((acc, p, i) => {
      if (i === 0) return `M ${p.x},${p.y}`
      const prev = pts[i - 1]
      const cx = (prev.x + p.x) / 2
      return `${acc} C ${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`
    }, '')
  }, [pts])

  const areaPath = linePath ? `${linePath} L 100,100 L 0,100 Z` : ''

  if (!data.length) return <ChartEmpty empty={empty} height={height} />

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    if (!rect.width) return
    const x = ((e.clientX - rect.left) / rect.width) * 100
    let idx = 0
    let best = Infinity
    pts.forEach((p, i) => {
      const dist = Math.abs(p.x - x)
      if (dist < best) {
        best = dist
        idx = i
      }
    })
    setActive(idx)
  }

  return (
    <div className={className}>
      <div
        ref={wrapRef}
        className="relative"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setActive(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Line chart">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1="0"
              x2="100"
              y1={100 - f * 100}
              y2={100 - f * 100}
              stroke="var(--line-subtle)"
              strokeWidth="0.3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {fill && <path d={areaPath} fill={`url(#${gradId})`} />}

          <motion.path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.15 }}
          />

        </svg>

        {/* Point dots — HTML overlays so they stay perfectly round under
            the SVG's non-uniform scaling (circles would stretch to ellipses). */}
        {pts.map((p, i) => (
          <div
            key={i}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: active === i ? 9 : 5,
              height: active === i ? 9 : 5,
              backgroundColor: color,
              border: '2px solid var(--bg-surface)',
              opacity: active === null || active === i ? 1 : 0.35,
              transition: 'width 0.15s ease, height 0.15s ease, opacity 0.15s ease',
            }}
          />
        ))}

        {/* Hover guide + tooltip */}
        {active !== null && pts[active] && (
          <>
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-line-strong"
              style={{ left: `${pts[active].x}%` }}
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-3 py-2 shadow-lg"
              style={{ left: `${pts[active].x}%`, top: `${pts[active].y}%` }}
            >
              <p className="whitespace-nowrap text-xs font-semibold text-fg">{data[active].label}</p>
              <p className="whitespace-nowrap text-chips text-muted">
                {formatValue(Number(data[active].value) || 0)}
              </p>
            </div>
          </>
        )}
      </div>

      {/* X labels */}
      <div className="mt-2 flex justify-between px-2">
        {data.map((d) => (
          <span key={d.label} className="truncate text-chips text-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  )
}

