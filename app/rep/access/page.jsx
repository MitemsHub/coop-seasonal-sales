'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Package, ShoppingBasket, Store } from 'lucide-react'
import EntryHeader from '../../components/EntryHeader'
import Badge from '../../components/ui/Badge'
import ModuleClosedPanel from '../../components/ModuleClosedPanel'

export const dynamic = 'force-dynamic'

// Module availability badge — shows whether each module is live before the rep
// logs in. Best-effort: while a status is unknown a skeleton renders, and a
// failed fetch leaves the card without a badge rather than blocking access.
function AvailabilityBadge({ open }) {
  if (open == null) {
    return (
      <span className="inline-flex h-[26px] w-[70px] items-center justify-center rounded-full bg-subtle" aria-hidden="true">
        <span className="h-3 w-12 animate-pulse rounded-full bg-muted/40" />
      </span>
    )
  }
  return (
    <Badge tone={open ? 'success' : 'neutral'} variant="subtle">
      <span className="inline-flex items-center gap-1">
        <span className={['h-1.5 w-1.5 rounded-full', open ? 'bg-success-fg' : 'bg-muted'].join(' ')} aria-hidden="true" />
        {open ? 'Opened' : 'Closed'}
      </span>
    </Badge>
  )
}

// Rep destinations for each module — open modules go straight to login; the
// closed panel's "View pending orders" routes here per module.
const MODULE_DEST = {
  food: '/rep/login?module=food',
  ram: '/rep/login?module=ram',
  exhibition: '/rep/login?module=exhibition',
}
const MODULE_ORDERS_DEST = {
  food: '/rep/posted',
  ram: '/rep/ram/approved',
  exhibition: '/rep/exhibition/pending',
}

export default function RepAccessPage() {
  const router = useRouter()
  const [availability, setAvailability] = useState({ food: null, ram: null, exhibition: null })
  const [closedModule, setClosedModule] = useState(null)

  const openModule = (module) => {
    // Opened modules go straight to login; closed modules open the panel first.
    if (availability[module]) router.push(MODULE_DEST[module])
    else setClosedModule(module)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [f, r, e] = await Promise.allSettled([
        fetch('/api/system/shopping', { cache: 'no-store' }),
        fetch('/api/system/ram-shopping', { cache: 'no-store' }),
        fetch('/api/system/exhibition-shopping', { cache: 'no-store' }),
      ])
      if (cancelled) return
      const read = async (p) => (p.status === 'fulfilled' ? (await p.value.json().catch(() => null)) : null)
      const [fj, rj, ej] = await Promise.all([read(f), read(r), read(e)])
      if (cancelled) return
      setAvailability({
        food: fj?.ok ? !!fj.open : null,
        ram: rj?.ok ? !!rj.open : null,
        exhibition: ej?.ok ? !!ej.open : null,
      })
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <EntryHeader
        subtitle="Reps Portal"
        links={[
          {
            href: '/rep/login?module=food',
            label: 'Food Distribution',
            icon: Package,
            badge: { open: availability.food },
          },
          {
            href: '/rep/login?module=ram',
            label: 'Ram Sales',
            icon: ShoppingBasket,
            badge: { open: availability.ram },
          },
          {
            href: '/rep/login?module=exhibition',
            label: 'Coop Exhibition',
            icon: Store,
            badge: { open: availability.exhibition },
          },
        ]}
      />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden p-4 sm:p-6">
        {/* Ambient tints — subtle, matching the portal hero */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />

        <div className="relative w-full max-w-4xl">
          <div className="mb-8 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
              Rep access
            </span>
            <h1 className="mt-4 text-h1 font-bold tracking-tight text-fg">Reps Portal</h1>
            <p className="mt-1.5 text-sm text-muted sm:text-base">Select the module you want to access.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {/* Food Distribution */}
            <button
              type="button"
              onClick={() => openModule('food')}
              className="group flex h-full flex-col rounded-xl border border-line bg-surface p-6 text-left shadow-xs transition-[border-color,box-shadow] duration-200 ease-sakani hover:border-line-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-fg ring-2 ring-brand-700/40 transition-transform duration-200 ease-sakani group-hover:scale-105">
                  <Package className="h-5.5 w-5.5" strokeWidth={2} />
                </span>
                <span className="flex flex-col items-end gap-1.5">
                  <AvailabilityBadge open={availability.food} />
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-fg">Food Distribution</h3>
              <p className="mt-1.5 flex-1 text-sm leading-5 text-fg/80">
                Manage food orders and the delivery workflow for your branch.
              </p>
              <span className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 ease-sakani group-hover:bg-brand-hover">
                Continue
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </button>

            {/* Ram Sales */}
            <button
              type="button"
              onClick={() => openModule('ram')}
              className="group flex h-full flex-col rounded-xl border border-line bg-surface p-6 text-left shadow-xs transition-[border-color,box-shadow] duration-200 ease-sakani hover:border-line-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-fg ring-2 ring-warning-600/50 transition-transform duration-200 ease-sakani group-hover:scale-105">
                  <ShoppingBasket className="h-5.5 w-5.5" strokeWidth={2} />
                </span>
                <span className="flex flex-col items-end gap-1.5">
                  <AvailabilityBadge open={availability.ram} />
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-fg">Ram Sales</h3>
              <p className="mt-1.5 flex-1 text-sm leading-5 text-fg/80">
                Manage ram orders and the delivery workflow for your branch.
              </p>
              <span className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 ease-sakani group-hover:bg-brand-hover">
                Continue
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </button>

            {/* Coop Exhibition */}
            <button
              type="button"
              onClick={() => openModule('exhibition')}
              className="group flex h-full flex-col rounded-xl border border-line bg-surface p-6 text-left shadow-xs transition-[border-color,box-shadow] duration-200 ease-sakani hover:border-line-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 sm:col-span-2 lg:col-span-1"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-fg ring-2 ring-info-600/50 transition-transform duration-200 ease-sakani group-hover:scale-105">
                  <Store className="h-5.5 w-5.5" strokeWidth={2} />
                </span>
                <span className="flex flex-col items-end gap-1.5">
                  <AvailabilityBadge open={availability.exhibition} />
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-fg">Coop Exhibition</h3>
              <p className="mt-1.5 flex-1 text-sm leading-5 text-fg/80">
                Approve and manage exhibition orders from your branch&apos;s vendor market.
              </p>
              <span className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 ease-sakani group-hover:bg-brand-hover">
                Continue
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </button>
          </div>
        </div>
      </main>

      {/* Shared closed-module panel — opens when a closed module card is tapped */}
      <ModuleClosedPanel
        module={closedModule || 'food'}
        variant="modal"
        rep
        open={!!closedModule}
        onClose={() => setClosedModule(null)}
        onViewOrders={() => {
          const dest = MODULE_ORDERS_DEST[closedModule] || '/rep/access'
          setClosedModule(null)
          router.push(dest)
        }}
        onBack={() => setClosedModule(null)}
      />
    </div>
  )
}
