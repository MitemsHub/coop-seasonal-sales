'use client'

// app/components/ui/StatCard.jsx
// Sakani stat card — fluid 20px→30px value with tight tracking, icon chip, trend delta + sparkline.
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import Skeleton from './Skeleton'

function Sparkline({ points, trend }) {
  const width = 200
  const height = 36
  const safe = Array.isArray(points) && points.length >= 2 ? points : [0, 0]
  const max = Math.max(...safe)
  const min = Math.min(...safe)
  const range = max - min || 1
  const step = width / (points.length - 1 || 1)
  const coords = points.map((p, i) => {
    const x = i * step
    const y = height - 3 - ((p - min) / range) * (height - 6)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const stroke = trend === 'up' ? 'var(--success-fg)' : trend === 'down' ? 'var(--danger-fg)' : 'var(--fg-subtle)'
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-9 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={coords.join(' ')} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const DELTA_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus }
const DELTA_COLOR = {
  up: 'text-success-fg',
  down: 'text-danger-fg',
  flat: 'text-muted',
}

export default function StatCard({
  icon: Icon,
  title,
  value,
  delta,
  trend = 'flat',
  sparkline,
  featured = false,
  loading = false,
  className = '',
}) {
  const DeltaIcon = DELTA_ICON[trend] || Minus
  return (
    <div
      className={[
        'flex min-w-[200px] flex-col gap-2 rounded-xl border border-line-subtle bg-surface p-3',
        'transition-[border-color,box-shadow] duration-200 ease-sakani hover:border-line-strong hover:shadow-md',
        featured && 'bg-accent-subtle',
        className,
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        {Icon && (
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-subtle text-fg">
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
        )}
        <span className="flex-1 text-[13px] font-medium text-muted">{title}</span>
        <span className="flex items-center gap-1 text-[13px] font-medium">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-subtle">
            {DeltaIcon && (
              <DeltaIcon className={['h-3 w-3', DELTA_COLOR[trend]].join(' ')} strokeWidth={2.4} />
            )}
          </span>
        </span>
      </div>

      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <div className="text-[clamp(1.25rem,1.25rem+0.38vw,1.875rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-fg">{value}</div>
      )}

      <div className="flex items-center gap-1 text-[13px] font-medium">
        {delta !== undefined && delta !== null && delta !== '' && (
          <span className={['inline-flex items-center gap-0.5', DELTA_COLOR[trend]].join(' ')}>
            {delta}
          </span>
        )}
      </div>

      {sparkline && <Sparkline points={sparkline} trend={trend} />}
    </div>
  )
}
