// app/components/ui/OrderStepper.jsx
// UI-kit order-progress stepper. One generic component renders any module's
// journey from its status metadata + step list; the module presets below bind
// it to the app's three order flows so pages never pass props:
//   ExhibitionOrderStepper — Pending → Approved → Delivered
//   RamOrderStepper        — Pending → Approved → Delivered (ram has its own
//                            Approve flow before the vendor hands over)
//   FoodOrderStepper       — Pending → Posted → Delivered
// All render the identical treatment (icon tiles, connector line, cancelled
// chip) so the modules never drift. Used by /exhibition/orders, the three
// tabs of /orders, and the My Coop recent-orders cards.
'use client'

import { CheckCircle2, Clock, Truck, XCircle } from 'lucide-react'

export const EXHIBITION_STATUS_META = {
  Pending: { tone: 'warning', label: 'Pending', icon: Clock, step: 0 },
  Approved: { tone: 'info', label: 'Approved', icon: CheckCircle2, step: 1 },
  Delivered: { tone: 'success', label: 'Delivered', icon: Truck, step: 2 },
  Cancelled: { tone: 'danger', label: 'Cancelled', icon: XCircle },
}

export const RAM_STATUS_META = {
  Pending: { tone: 'warning', label: 'Pending', icon: Clock, step: 0 },
  Approved: { tone: 'info', label: 'Approved', icon: CheckCircle2, step: 1 },
  Delivered: { tone: 'success', label: 'Delivered', icon: Truck, step: 2 },
  Cancelled: { tone: 'danger', label: 'Cancelled', icon: XCircle },
}

export const FOOD_STATUS_META = {
  Pending: { tone: 'warning', label: 'Pending', icon: Clock, step: 0 },
  Posted: { tone: 'info', label: 'Posted', icon: CheckCircle2, step: 1 },
  Delivered: { tone: 'success', label: 'Delivered', icon: Truck, step: 2 },
  Cancelled: { tone: 'danger', label: 'Cancelled', icon: XCircle },
}

const APPROVE_STEPS = [
  { key: 'Pending', label: 'Pending', icon: Clock },
  { key: 'Approved', label: 'Approved', icon: CheckCircle2 },
  { key: 'Delivered', label: 'Delivered', icon: Truck },
]

const FOOD_STEPS = [
  { key: 'Pending', label: 'Pending', icon: Clock },
  { key: 'Posted', label: 'Posted', icon: CheckCircle2 },
  { key: 'Delivered', label: 'Delivered', icon: Truck },
]

function CancelledChip() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-danger-border bg-danger-bg/50 px-3 py-2">
      <XCircle className="h-4 w-4 shrink-0 text-danger-fg" strokeWidth={2} />
      <p className="text-xs font-medium text-danger-fg">This order was cancelled.</p>
    </div>
  )
}

// Generic kit component — render any module's progress by passing its status
// metadata map (see the module presets below for the canonical usage).
export default function OrderStepper({ status, meta, steps }) {
  const current = meta?.[status]
  if (!current || status === 'Cancelled') return <CancelledChip />
  return (
    <ol className="flex items-center" aria-label="Order progress">
      {steps.map((s, i) => {
        const done = i < current.step
        const isCurrent = i === current.step
        return (
          <li key={s.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={[
                  'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200',
                  done ? 'bg-success-fg text-on-accent' : isCurrent ? 'bg-brand text-on-accent' : 'bg-subtle text-subtext',
                ].join(' ')}
              >
                <s.icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
              <span className={['text-chips font-medium', done || isCurrent ? 'text-fg' : 'text-subtext'].join(' ')}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={['mx-2 mb-4 h-0.5 flex-1 rounded-full', i < current.step ? 'bg-success-fg/60' : 'bg-line-subtle'].join(' ')}
                aria-hidden="true"
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ── Module presets ────────────────────────────────────────────────────────

export function ExhibitionOrderStepper({ status }) {
  return <OrderStepper status={status} meta={EXHIBITION_STATUS_META} steps={APPROVE_STEPS} />
}

export function RamOrderStepper({ status }) {
  return <OrderStepper status={status} meta={RAM_STATUS_META} steps={APPROVE_STEPS} />
}

export function FoodOrderStepper({ status }) {
  return <OrderStepper status={status} meta={FOOD_STATUS_META} steps={FOOD_STEPS} />
}
