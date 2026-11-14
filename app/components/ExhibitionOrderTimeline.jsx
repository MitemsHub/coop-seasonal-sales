'use client'

// app/components/ExhibitionOrderTimeline.jsx
// The member's view of an exhibition order:
//   Placed -> Approved -> Confirmed
//
// Times come from the order itself:
//   placed    created_at
//   approved  approved_at
//   confirmed member_confirmed_at (admin override also stamps this)
import { BadgeCheck, CheckCircle2, Package, XCircle } from 'lucide-react'

function fmt(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function ExhibitionOrderTimeline({ order }) {
  if (!order) return null

  if (order.status === 'Cancelled') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg/50 px-3 py-2">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-fg" strokeWidth={2} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-danger-fg">Order cancelled</p>
          <p className="text-chips text-danger-fg/80">
            {order.cancelled_reason || `Cancelled ${fmt(order.cancelled_at) || 'by the Coop'}`}
          </p>
        </div>
      </div>
    )
  }

  const steps = [
    { key: 'placed', label: 'Placed', at: order.created_at, icon: Package },
    { key: 'approved', label: 'Approved', at: order.approved_at, icon: CheckCircle2 },
    { key: 'confirmed', label: 'Confirmed', at: order.member_confirmed_at, icon: BadgeCheck },
  ]

  const reachedIndex = steps.reduce((last, s, i) => (s.at ? i : last), 0)

  return (
    <div>
      <ol className="flex items-start gap-1">
        {steps.map((s, i) => {
          const done = i <= reachedIndex && !!s.at
          const current = i === reachedIndex
          const Icon = s.icon
          return (
            <li key={s.key} className="min-w-0 flex-1">
              <div className="flex items-center">
                <span
                  className={[
                    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                    done
                      ? current
                        ? 'border-success-fg bg-success-fg text-on-accent'
                        : 'border-success-border bg-success-bg text-success-fg'
                      : 'border-line bg-subtle text-subtext',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
                </span>
                {i < steps.length - 1 && (
                  <span
                    className={['ml-1 h-0.5 flex-1 rounded-full', i < reachedIndex ? 'bg-success-fg' : 'bg-line'].join(' ')}
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="mt-1.5 pr-1">
                <div className={['truncate text-chips font-semibold', done ? 'text-fg' : 'text-subtext'].join(' ')}>
                  {s.label}
                </div>
                <div className="truncate text-[10px] leading-tight text-muted">
                  {s.at ? fmt(s.at) : i === reachedIndex + 1 ? 'Next' : '—'}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
