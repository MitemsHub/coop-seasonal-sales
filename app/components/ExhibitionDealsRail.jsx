'use client'

// app/components/ExhibitionDealsRail.jsx
// "Market bonanza" — a rail built only from products whose vendor set a real
// discount (discount_pct > 0). Nothing here is invented: if no vendor is
// cutting prices, the rail does not render at all, so the badge can be trusted.
//
// Cards are the normal ExhibitionProductCard, so a deal opens the same details
// popup, shows the same stock badges and adds to the same cart as the shelf.
import { useMemo } from 'react'
import { Flame, Sparkles } from 'lucide-react'
import ExhibitionProductCard from './ExhibitionProductCard'

export default function ExhibitionDealsRail({ products = [], onAdd, qtyOf }) {
  const deals = useMemo(() => {
    return products
      .filter((p) => Number(p.discount_pct) > 0)
      .sort((a, b) => Number(b.discount_pct) - Number(a.discount_pct))
      .slice(0, 12)
  }, [products])

  if (!deals.length) return null

  const biggest = Number(deals[0].discount_pct)

  return (
    <section
      aria-label="Market bonanza — stand discounts"
      className="mb-fluid-md overflow-hidden rounded-2xl border border-warning-border bg-gradient-to-br from-warning-bg via-surface to-accent-subtle/70"
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-solid px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
            <Flame className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
            Market bonanza
          </span>
          <p className="mt-1 text-xs font-semibold text-fg">
            Up to {biggest}% off — {deals.length} stand deal{deals.length === 1 ? '' : 's'} live now
          </p>
          <p className="text-[11px] text-muted">Real vendor discounts, applied at checkout</p>
        </div>
        <Sparkles
          className="motion-safe:animate-pulse h-5 w-5 shrink-0 text-accent"
          strokeWidth={2}
          aria-hidden="true"
        />
      </div>

      <div className="scrollbar-hide mt-2 flex snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain px-3 pb-3">
        {deals.map((p) => (
          <div
            key={p.id}
            className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[19.5%] xl:w-[15.5%]"
          >
            <ExhibitionProductCard p={p} qty={qtyOf(p.id)} onAdd={(d) => onAdd(p, d)} />
          </div>
        ))}
      </div>
    </section>
  )
}
