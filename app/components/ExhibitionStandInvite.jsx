// app/components/ExhibitionStandInvite.jsx
// The online shopfront is paused for the 2026 exhibition. Members buy at the
// stand; their balance and credit facility already live on My Coop, so this
// screen only tells them where to go and where their invoices appear.
'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight, MapPin, Store } from 'lucide-react'

export default function ExhibitionStandInvite() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-2xl p-fluid pb-24">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
          <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
          Coop Exhibition 2026
        </div>

        <h1 className="font-display text-h1 font-semibold tracking-tight text-fg">Shop at the exhibition stand</h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
          The online shop is paused this season. Pick your items at the stand — the vendor raises your invoice, the
          admin approves it, and you confirm once the goods are in your hands.
        </p>

        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-3 bg-brand p-4 text-on-accent">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
              <MapPin className="h-4.5 w-4.5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">Delivery location</p>
              <p className="mt-0.5 truncate text-sm font-semibold">Exhibition stand · your branch</p>
            </div>
          </div>
          <p className="p-4 text-sm text-muted">
            Your balance and credit facility are on your <span className="font-medium text-fg">My Coop</span> page.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => router.push('/exhibition/orders')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            See my invoices
            <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => router.push('/my-coop')}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-fg transition-colors duration-200 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Go to My Coop
          </button>
        </div>
      </div>
    </div>
  )
}
