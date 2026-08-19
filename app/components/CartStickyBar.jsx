// app/components/CartStickyBar.jsx
// The single sticky/fixed cart bar used across every shopping surface so the
// food shop, exhibition shop and vendor hub can never drift out of sync.
//
// Two variants share the same formatter + design tokens:
//   - 'compact'  → the full-width fixed bottom strip (exhibition shop, vendor
//                  hub): cart icon + count badge, "N items · ₦total", optional
//                  subtitle, and a Go to Cart button. Hidden when the cart is
//                  empty (count <= 0) — callers don't have to remember to gate.
//   - 'summary'  → the food shop's sticky floating card: Items / Total /
//                  Remaining stat boxes, View Summary toggle with the
//                  expandable line-item breakdown, over-limit warning and the
//                  page's inline message.
'use client'

import { ChevronDown, ChevronUp, ShoppingCart } from 'lucide-react'
import Button from './ui/Button'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

export default function CartStickyBar({
  // Common
  variant = 'compact',
  count = 0, // number of distinct line items
  total = 0, // cart subtotal (number) — formatted with naira()
  onGoToCart, // required: route to the module's cart
  goingToCart = false,

  // compact only
  subtitle, // e.g. "Negotiated prices applied where they exist"

  // summary only (food shop)
  lines = [], // { sku, name, qty, price, amount }
  units = 0, // total units across lines (badge on Go to Cart)
  loanInterest = 0,
  loanInterestRatePct = 0,
  totalWithInterest = 0,
  overLimit = false,
  remainingLimit = 0,
  paymentOption = 'Cash',
  summaryOpen = false,
  onToggleSummary,
  message = null, // { type: 'success'|'error', text } from the page
}) {
  if (variant === 'compact') {
    if (count <= 0) return null
    return (
      <div data-cart-bar="compact" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">
              <span className="relative inline-flex">
                <ShoppingCart className="h-4.5 w-4.5 text-brand" strokeWidth={2} />
                <span className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-accent">
                  {count}
                </span>
              </span>
              <span className="truncate">
                {count} {count === 1 ? 'item' : 'items'} · {naira(total)}
              </span>
            </div>
            {subtitle && <p className="text-chips text-muted">{subtitle}</p>}
          </div>
          <Button size="lg" onClick={onGoToCart}>
            Go to Cart
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div data-cart-bar="summary" className="sticky bottom-2 z-10 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur-sm md:bottom-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid flex-1 grid-cols-3 gap-1.5 sm:gap-2">
          <div className="rounded-xl bg-subtle/70 px-1.5 py-2 text-center sm:px-3">
            <div className="text-chips font-medium text-muted">Items</div>
            <div className="text-xs font-semibold tabular-nums text-fg sm:text-sm">{lines.length}</div>
          </div>
          <div className="rounded-xl bg-subtle/70 px-1.5 py-2 text-center sm:px-3">
            <div className="text-chips font-medium text-muted">Total</div>
            <div className="text-xs font-semibold tabular-nums text-fg sm:text-sm">{naira(total)}</div>
            {paymentOption === 'Loan' && loanInterest > 0 && (
              <div className="text-chips font-medium text-muted">incl. {naira(loanInterest)} interest</div>
            )}
          </div>
          <div className={['rounded-xl px-1.5 py-2 text-center sm:px-3', overLimit ? 'bg-danger-bg' : 'bg-subtle/70'].join(' ')}>
            <div className={['text-chips font-medium', overLimit ? 'text-danger-fg' : 'text-muted'].join(' ')}>Remaining</div>
            <div className={['text-xs font-semibold tabular-nums', overLimit ? 'text-danger-fg' : 'text-fg'].join(' ')}>
              {paymentOption === 'Cash' ? 'No limit' : naira(remainingLimit)}
            </div>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1 sm:flex-none"
            disabled={lines.length === 0}
            leftIcon={summaryOpen && lines.length > 0 ? ChevronUp : ChevronDown}
            onClick={onToggleSummary}
          >
            {summaryOpen && lines.length > 0 ? 'Hide Summary' : 'View Summary'}
          </Button>
          <Button
            size="lg"
            className="relative flex-1 sm:flex-none"
            disabled={lines.length === 0 || goingToCart}
            loading={goingToCart}
            leftIcon={ShoppingCart}
            aria-label={units > 0 ? `Go to Cart (${units} item${units === 1 ? '' : 's'})` : 'Go to Cart'}
            onClick={onGoToCart}
          >
            Go to Cart
            {units > 0 && (
              <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold tabular-nums text-accent-fg shadow-sm">
                {units}
              </span>
            )}
          </Button>
        </div>
      </div>

      {summaryOpen && lines.length > 0 && (
        <div className="mt-3 border-t border-line-subtle pt-3">
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {lines.map((line) => (
              <div key={line.sku} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-fg">{line.name}</span>
                <span className="shrink-0 text-muted">
                  {line.qty} × {naira(line.price)}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-fg">{naira(line.amount)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1 border-t border-line-subtle pt-2 text-xs">
            <div className="flex items-center justify-between text-muted">
              <span>Subtotal</span>
              <span className="font-semibold tabular-nums text-fg">{naira(total)}</span>
            </div>
            {paymentOption === 'Loan' && loanInterest > 0 && (
              <div className="flex items-center justify-between text-muted">
                <span>Interest ({loanInterestRatePct}%)</span>
                <span className="font-semibold tabular-nums text-warning-fg">{naira(loanInterest)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-line-subtle pt-1.5 text-sm font-semibold text-fg">
              <span>Total</span>
              <span className="tabular-nums">{naira(totalWithInterest)}</span>
            </div>
          </div>
        </div>
      )}

      {overLimit && (
        <p className="mt-2 text-xs font-medium text-danger-fg">
          Total exceeds {paymentOption} limit. Reduce quantities or switch payment method.
        </p>
      )}
      {message && (
        <p className={['mt-2 text-xs font-medium', message.type === 'success' ? 'text-success-fg' : 'text-danger-fg'].join(' ')}>
          {message.text}
        </p>
      )}
    </div>
  )
}
