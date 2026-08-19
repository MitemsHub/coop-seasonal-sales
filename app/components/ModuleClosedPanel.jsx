'use client'

// app/components/ModuleClosedPanel.jsx
// Shared "module closed" panel for the member portal.
//  - variant="modal"  : DraggableModal overlay — opened from the dashboard's
//    module cards when the module is closed.
//  - variant="inline" : full-page closed-state view — rendered inside /shop
//    and /ram/shop when their module is closed.
// Both share the same body: module icon tile, "Closed" badge, title,
// description, and the two CTAs (View my orders / Back to dashboard).
import { ArrowRight, Beef, Clock, Home, ShoppingBasket, Store } from 'lucide-react'
import DraggableModal from './DraggableModal'
import Button from './ui/Button'
import Badge from './ui/Badge'

const MODULE_META = {
  food: {
    name: 'Food Distribution',
    icon: ShoppingBasket,
    iconClass: 'bg-brand-subtle text-brand',
    ringClass: 'ring-brand/30',
    badgeTone: 'neutral',
    title: 'Food Distribution is closed',
    description:
      'The food shop reopens when the next cycle starts. Your past orders and payment records stay available in the meantime.',
  },
  ram: {
    name: 'Ram Sales',
    icon: Beef,
    iconClass: 'bg-accent-subtle text-accent-fg',
    ringClass: 'ring-accent/30',
    badgeTone: 'neutral',
    title: 'Ram Sales is closed',
    description:
      'The Ram season reopens when the next one begins. Your past orders and payment records stay available in the meantime.',
  },
  exhibition: {
    name: 'Coop Exhibition',
    icon: Store,
    iconClass: 'bg-accent-subtle text-accent',
    ringClass: 'ring-accent/30',
    badgeTone: 'neutral',
    title: 'The Exhibition is closed',
    description:
      'The exhibition market opens seasonally at your branch. When it opens, vendors stand up and the catalog goes live here.',
  },
}

const REP_META = {
  food: {
    title: 'Food Distribution is closed',
    description:
      'The food cycle is not live right now. Access reopens for reps when the next cycle starts at your branch.',
  },
  ram: {
    title: 'Ram Sales is closed',
    description:
      'The Ram season is not live right now. Access reopens for reps when the next season begins.',
  },
  exhibition: {
    title: 'The Exhibition is closed',
    description:
      'The exhibition market opens seasonally at your branch. Rep access reopens when the next exhibition cycle goes live.',
  },
}

const VENDOR_META = {
  exhibition: {
    title: 'The Exhibition is closed',
    description:
      'The exhibition market opens seasonally at your branch. Your stand and catalog go live when the next cycle opens.',
  },
}

function ModuleClosedBody({ module, onViewOrders, onBack, rep = false, vendor = false, hint }) {
  const meta = MODULE_META[module] || MODULE_META.food
  const copy = rep
    ? REP_META[module] || REP_META.food
    : vendor
      ? VENDOR_META[module] || meta
      : meta
  const Icon = meta.icon

  return (
    <div className="flex flex-col items-center text-center">
      <span className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl ${meta.iconClass} ring-8 ${meta.ringClass}`}>
        <Icon className="h-7 w-7" strokeWidth={2} />
      </span>

      <Badge tone={meta.badgeTone} variant="subtle" icon={Clock} className="mt-4">
        Currently closed
      </Badge>

      <h3 className="mt-2 font-display text-lg font-semibold tracking-tight text-fg">
        {copy.title}
      </h3>
      <p className="mt-1.5 max-w-xs text-sm text-muted">{copy.description}</p>
      {!!hint && <div className="mt-2">{hint}</div>}

      <div className="mt-5 flex w-full flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1 min-w-0"
          rightIcon={ArrowRight}
          onClick={onViewOrders}
        >
          <span className="min-w-0 truncate">{rep ? 'View pending orders' : 'View my orders'}</span>
        </Button>
        <Button variant="secondary" className="flex-1 min-w-0" leftIcon={Home} onClick={onBack}>
          <span className="min-w-0 truncate">{rep ? 'Back to Reps Portal' : 'Back to dashboard'}</span>
        </Button>
      </div>
    </div>
  )
}

export default function ModuleClosedPanel({
  module = 'food',
  variant = 'modal',
  open = false,
  onClose,
  onViewOrders,
  onBack,
  rep = false,
  vendor = false,
  hint,
}) {
  const meta = MODULE_META[module] || MODULE_META.food
  const copy = rep
    ? REP_META[module] || REP_META.food
    : vendor
      ? VENDOR_META[module] || meta
      : meta

  if (variant === 'inline') {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-3 py-10">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-lg shadow-black/5">
            <ModuleClosedBody module={module} onViewOrders={onViewOrders} onBack={onBack} rep={rep} vendor={vendor} hint={hint} />
          </div>
          <p className="mt-3 text-center text-chips text-muted">
            {meta.name} · Check back when the next cycle opens
          </p>
        </div>
      </div>
    )
  }

  return (
    <DraggableModal
      open={open}
      onClose={onClose}
      title={copy.title}
      widthClass="max-w-sm w-full mx-4"
      overlayClassName="bg-black/25 backdrop-blur-[2px]"
    >
      <ModuleClosedBody module={module} onViewOrders={onViewOrders} onBack={onBack} rep={rep} vendor={vendor} />
    </DraggableModal>
  )
}
