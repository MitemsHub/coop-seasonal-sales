// app/exhibition/cart/page.jsx
// Coop Exhibition checkout — same flow and design language as the food cart:
// line items with quantity controls, delivery branch + department, payment
// method (Savings / Loan / Cash), eligibility-aware summary and submit.
'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Banknote,
  Check,
  CreditCard,
  Info,
  MapPin,
  Minus,
  Plus,
  Receipt,
  ShoppingCart,
  Store,
  Trash2,
  Wallet,
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import { touchCart } from '@/lib/cartTouch'
import { useAuth } from '../../contexts/AuthContext'
import useCartCount from '../../hooks/useCartCount'
import { useToast } from '../../components/ui/Toast'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import Label from '../../components/ui/Label'
import Select from '../../components/ui/Select'
import Spinner from '../../components/ui/Spinner'
import Skeleton from '../../components/ui/Skeleton'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

function ExhibitionCartContent() {
  const router = useRouter()
  const { user } = useAuth()
  const toast = useToast()
  const memberId = String(user?.id || '').trim().toUpperCase()
  const { announceCart, onChange: onCartChange } = useCartCount('exhibition', { memberId })

  const [cart, setCart] = useState([])
  const [branches, setBranches] = useState([])
  const [departments, setDepartments] = useState([])
  const [deliveryBranch, setDeliveryBranch] = useState('')
  const [department, setDepartment] = useState('')
  const [paymentOption, setPaymentOption] = useState('Savings')
  const [eligibility, setEligibility] = useState({ savingsEligible: 0, loanEligible: 0 })
  const [loanRatePct, setLoanRatePct] = useState(13)
  const [message, setMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)

  const emitToast = (type, text) => {
    try {
      window.dispatchEvent(new CustomEvent('app-toast', { detail: { type, text } }))
    } catch {}
  }

  const persist = (key, val) => {
    try {
      if (memberId) localStorage.setItem(key, val)
    } catch {}
  }

  // Load cart, branches, departments, cycle rate + member branch default
  useEffect(() => {
    if (!memberId) return
    let cancelled = false
    ;(async () => {
      try {
        const raw = localStorage.getItem(`exhibitionCart_${memberId}`)
        if (!cancelled) setCart(raw ? JSON.parse(raw) : [])
      } catch {}
      try {
        const [br, dp, cat] = await Promise.all([
          // Delivery dropdown = branches with an OPEN exhibition cycle only.
          fetch('/api/exhibition/delivery-branches').then((r) => r.json()).catch(() => null),
          fetch('/api/departments/list').then((r) => r.json()).catch(() => null),
          fetch(`/api/exhibition/catalog?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        ])
        if (cancelled) return
        if (br?.ok) setBranches(br.branches || [])
        if (dp?.ok) setDepartments(dp.departments || [])
        if (cat?.ok) {
          setOpen(!!cat.open)
          if (cat.cycle) setLoanRatePct(Number(cat.cycle.loan_interest_rate_pct ?? 13))
          // Re-sync line prices with the current catalog — a negotiated price
          // may have been set or changed since the items were added, and the
          // cart should always show the member's latest price.
          try {
            const raw = localStorage.getItem(`exhibitionCart_${memberId}`)
            if (raw) {
              const lines = JSON.parse(raw)
              if (Array.isArray(lines)) {
                const byId = new Map((cat.products || []).map((p) => [p.id, p]))
                let changed = 0
                const next = lines.map((l) => {
                  const p = byId.get(l.product_id)
                  if (!p) return l
                  const changedPrice = Number(p.price) !== Number(l.price)
                  if (changedPrice) changed++
                  return changedPrice || !!p.negotiated !== !!l.negotiated
                    ? { ...l, price: p.price, negotiated: !!p.negotiated }
                    : l
                })
                if (changed > 0) {
                  try {
                    localStorage.setItem(`exhibitionCart_${memberId}`, JSON.stringify(next))
                  } catch {}
                  announceCart(next.reduce((s, l) => s + (Number(l?.qty) || 0), 0))
                  setCart(next)
                  toast.success(
                    changed === 1
                      ? 'One item\u2019s price was updated to your latest negotiated price.'
                      : `${changed} items\u2019 prices were updated to your latest negotiated prices.`
                  )
                } else {
                  setCart(lines)
                }
              }
            }
          } catch {}
        }
      } catch {}
      try {
        const elig = await fetch(`/api/members/eligibility?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
        if (!cancelled && elig?.ok) {
          setEligibility({
            savingsEligible: Number(elig.eligibility.savingsEligible || 0),
            loanEligible: Number(elig.eligibility.loanEligible || 0),
          })
        }
      } catch {}
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [memberId])

  // Cross-tab freshness — the hook delivers the stored cart on mount and on
  // every external change (the shop, a vendor hub, another tab), skipping our
  // own persistCart echoes. The equality guard keeps no-op adoptions from
  // re-rendering.
  useEffect(() => {
    if (!memberId) return
    return onCartChange((value) => {
      const next = Array.isArray(value) ? value : []
      setCart((prev) => {
        const same =
          prev.length === next.length &&
          next.every(
            (l, i) =>
              prev[i]?.product_id === l.product_id &&
              Number(prev[i]?.qty) === Number(l.qty) &&
              Number(prev[i]?.price) === Number(l.price) &&
              !!prev[i]?.negotiated === !!l.negotiated
          )
        return same ? prev : next
      })
    })
  }, [memberId, onCartChange])

  // Restore saved delivery/department/payment
  useEffect(() => {
    if (!memberId || !branches.length) return
    try {
      const d = localStorage.getItem(`exhibitionDeliveryBranch_${memberId}`)
      const dep = localStorage.getItem(`exhibitionDepartment_${memberId}`)
      const pay = localStorage.getItem(`exhibitionPaymentOption_${memberId}`)
      if (d) setDeliveryBranch(d)
      if (dep) setDepartment(dep)
      if (pay) setPaymentOption(pay)
    } catch {}
  }, [memberId, branches.length])

  const persistCart = (next) => {
    setCart(next)
    try {
      localStorage.setItem(`exhibitionCart_${memberId}`, JSON.stringify(next))
      touchCart('exhibition', memberId)
    } catch {}
    announceCart(next.reduce((s, l) => s + (Number(l?.qty) || 0), 0))
  }

  const updateQty = (productId, delta) => {
    const item = cart.find((l) => l.product_id === productId)
    if (!item) return
    const nextQty = Math.max(0, item.qty + delta)
    let next = cart.map((l) => (l.product_id === productId ? { ...l, qty: nextQty } : l)).filter((l) => l.qty > 0)
    persistCart(next)
  }

  const removeItem = (productId) => {
    const next = cart.filter((l) => l.product_id !== productId)
    persistCart(next)
  }

  const cartTotal = cart.reduce((s, l) => s + l.price * l.qty, 0)
  const loanInterest = paymentOption === 'Loan' ? Math.round(cartTotal * (loanRatePct / 100)) : 0
  const totalWithInterest = paymentOption === 'Loan' ? cartTotal + loanInterest : cartTotal

  const currentLimit = paymentOption === 'Savings' ? Number(eligibility.savingsEligible || 0) : paymentOption === 'Loan' ? Number(eligibility.loanEligible || 0) : Number.POSITIVE_INFINITY
  const overLimit = paymentOption !== 'Cash' && totalWithInterest > currentLimit
  const canSubmit = cart.length > 0 && !overLimit && deliveryBranch && department

  const submitDisabledReason = useMemo(() => {
    if (submitting) return null
    if (cart.length === 0) return 'Add at least one product to your cart.'
    if (!open) return 'The exhibition is closed.'
    if (!deliveryBranch) return 'Select a delivery branch to continue.'
    if (!department) return 'Select your department to continue.'
    if (overLimit) return `Total exceeds your ${paymentOption} limit. Reduce quantities or switch payment method.`
    return null
  }, [cart.length, department, deliveryBranch, open, overLimit, paymentOption, submitting])

  const submitOrder = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/exhibition/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          member_id: memberId,
          delivery_branch_code: deliveryBranch,
          department_name: department,
          payment_option: paymentOption,
          lines: cart.map((l) => ({ product_id: l.product_id, qty: l.qty })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to submit order' })
        return
      }
      // Clear the exhibition cart
      try {
        localStorage.removeItem(`exhibitionCart_${memberId}`)
        localStorage.removeItem(`exhibitionDeliveryBranch_${memberId}`)
        localStorage.removeItem(`exhibitionDepartment_${memberId}`)
      } catch {}
      announceCart(0)
      router.push(`/exhibition/success/${data.order_id}`)
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || 'Network error. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-subtle">
            <Spinner size={20} className="text-accent" />
          </div>
          <p className="text-sm text-muted">Loading your exhibition cart…</p>
        </div>
      </div>
    )
  }

  const paymentOptions = [
    { key: 'Savings', icon: Banknote, disabled: Number(eligibility.savingsEligible || 0) <= 0, title: 'Pay from your savings balance' },
    { key: 'Loan', icon: Wallet, disabled: false, title: `Pay on loan (${loanRatePct}% interest applies)` },
    { key: 'Cash', icon: CreditCard, disabled: false, title: 'Pay in cash on delivery' },
  ]

  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="min-h-screen bg-canvas">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl p-fluid pb-28 sm:pb-32 md:pb-36">
          {/* Hero */}
          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
                <ShoppingCart className="h-3.5 w-3.5" strokeWidth={2.2} />
                Exhibition Checkout
              </div>
              <h1 className="mt-1.5 font-display text-h1 font-semibold tracking-tight text-fg">Your Cart</h1>
              <p className="mt-1 text-sm text-muted">Review your items, pick a delivery branch and pay your way.</p>
            </div>
          </div>

          {!open && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg/60 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" strokeWidth={2} />
              <p className="text-xs font-medium text-warning-fg">The exhibition is closed. You can still review your cart, but orders won't be accepted until the market opens.</p>
            </div>
          )}

          {/* Delivery & Payment */}
          <div className="ui-card mb-fluid-lg p-fluid-md sm:p-fluid-lg">
            <div className="grid grid-cols-1 gap-fluid-lg md:grid-cols-2">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                    <MapPin className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h3 className="text-sm font-semibold text-fg">Delivery Details</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="exh-cart-branch">Delivery Branch</Label>
                    <Select
                      id="exh-cart-branch"
                      value={deliveryBranch}
                      onChange={(e) => {
                        const v = e.target.value
                        setDeliveryBranch(v)
                        persist(`exhibitionDeliveryBranch_${memberId}`, v)
                      }}
                      className="w-full"
                    >
                      <option value="">Select delivery branch</option>
                      {branches.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.name} ({b.code})
                        </option>
                      ))}
                      {branches.length === 0 && <option value="" disabled>No open exhibition locations right now</option>}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="exh-cart-dept">Department</Label>
                    <Select
                      id="exh-cart-dept"
                      value={department}
                      onChange={(e) => {
                        const v = e.target.value
                        setDepartment(v)
                        persist(`exhibitionDepartment_${memberId}`, v)
                      }}
                      className="w-full"
                    >
                      <option value="">Select department</option>
                      {departments.map((d, i) => (
                        <option key={d?.id || i} value={d.name || d}>
                          {d.name || d}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent">
                    <CreditCard className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h3 className="text-sm font-semibold text-fg">Payment</h3>
                </div>
                <Label htmlFor="exh-cart-payment">Payment Method</Label>
                <div id="exh-cart-payment" role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1">
                  {paymentOptions.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      role="radio"
                      aria-checked={paymentOption === opt.key}
                      disabled={opt.disabled}
                      title={opt.title}
                      onClick={() => {
                        setPaymentOption(opt.key)
                        persist(`exhibitionPaymentOption_${memberId}`, opt.key)
                      }}
                      className={[
                        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-all duration-200 ease-sakani',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                        paymentOption === opt.key
                          ? 'bg-brand text-on-accent shadow-xs'
                          : opt.disabled
                            ? 'cursor-not-allowed text-muted opacity-50'
                            : 'text-muted hover:bg-surface hover:text-fg',
                      ].join(' ')}
                    >
                      <opt.icon className="h-4 w-4" strokeWidth={2} />
                      {opt.key}
                    </button>
                  ))}
                </div>

                <div className="mt-3 space-y-1.5 rounded-xl border border-line-subtle bg-subtle/60 p-3">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Items</span>
                    <span className="font-semibold text-fg">{cart.length}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>Total</span>
                    <span className="font-semibold text-fg">{naira(cartTotal)}</span>
                  </div>
                  {paymentOption === 'Loan' && (
                    <div className="flex justify-between text-xs text-muted">
                      <span>Interest ({loanRatePct}%)</span>
                      <span className="font-semibold text-warning-fg">{naira(loanInterest)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-fluid-md lg:grid-cols-3">
            {/* Cart items */}
            <div className="lg:col-span-2">
              <div className="ui-card p-fluid-md">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                    <Store className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h2 className="text-sm font-semibold text-fg">Items from your stands</h2>
                  <Badge tone="brand" variant="subtle">
                    {cart.length} {cart.length === 1 ? 'item' : 'items'}
                  </Badge>
                </div>

                {cart.length === 0 ? (
                  <EmptyState
                    icon={ShoppingCart}
                    title="Your cart is empty"
                    description="Browse the exhibition and add products to get started."
                  >
                    <Button leftIcon={Store} onClick={() => router.push('/exhibition')}>
                      Browse Exhibition
                    </Button>
                  </EmptyState>
                ) : (
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div
                        key={item.product_id}
                        className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 sm:flex-row sm:items-center"
                      >
                        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-subtle">
                          <Image
                            src={item.image_url || '/images/items/placeholder.svg'}
                            alt={item.name}
                            fill
                            sizes="64px"
                            className="object-cover"
                            onError={(e) => {
                              e.currentTarget.src = '/images/items/placeholder.svg'
                            }}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold break-words text-fg">{item.name}</div>
                          <div className="mt-0.5 text-chips text-muted">
                            {item.vendor_name} · {item.unit}
                            {item.negotiated && <span className="ml-1.5 font-semibold text-accent">your negotiated price</span>}
                          </div>
                          <div className="mt-0.5 text-sm font-bold tabular-nums text-brand">{naira(item.price)}</div>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <div className="flex items-center overflow-hidden rounded-lg border border-line bg-surface">
                            <button
                              type="button"
                              onClick={() => updateQty(item.product_id, -1)}
                              aria-label={`Decrease ${item.name}`}
                              className="inline-flex h-9 w-9 items-center justify-center bg-subtle text-fg transition-colors duration-150 hover:bg-danger-bg hover:text-danger-fg"
                            >
                              <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </button>
                            <div className="w-11 text-center text-sm font-bold tabular-nums text-fg">{item.qty}</div>
                            <button
                              type="button"
                              onClick={() => updateQty(item.product_id, 1)}
                              aria-label={`Increase ${item.name}`}
                              className="inline-flex h-9 w-9 items-center justify-center bg-subtle text-fg transition-colors duration-150 hover:bg-success-bg hover:text-success-fg"
                            >
                              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </button>
                          </div>
                          <div className="w-24 text-right">
                            <div className="text-sm font-bold tabular-nums text-fg">{naira(item.price * item.qty)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(item.product_id)}
                            aria-label={`Remove ${item.name}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-bg hover:text-danger-fg"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Order summary */}
            <div className="space-y-3">
              <div className="ui-card p-fluid-md lg:sticky lg:top-16">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent">
                    <Receipt className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <h3 className="text-sm font-semibold text-fg">Order Summary</h3>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-line-subtle bg-subtle/60 px-2 py-2.5 text-center">
                    <div className="text-sm font-bold tabular-nums text-fg sm:text-base">{cart.length}</div>
                    <div className="text-chips font-medium text-muted">Items</div>
                  </div>
                  <div className="rounded-xl border border-line-subtle bg-subtle/60 px-2 py-2.5 text-center">
                    <div className="text-sm font-bold tabular-nums text-fg sm:text-base">{naira(cartTotal)}</div>
                    <div className="text-chips font-medium text-muted">Cart Total</div>
                  </div>
                  {paymentOption === 'Loan' && (
                    <div className="rounded-xl border border-warning-border bg-warning-bg/60 px-2 py-2.5 text-center">
                      <div className="text-sm font-bold tabular-nums text-warning-fg sm:text-base">{naira(loanInterest)}</div>
                      <div className="text-chips font-medium text-warning-fg">Interest ({loanRatePct}%)</div>
                    </div>
                  )}
                  <div className="rounded-xl border border-brand/20 bg-brand-subtle/60 px-2 py-2.5 text-center">
                    <div className="text-sm font-bold tabular-nums text-brand-fg sm:text-base">
                      {currentLimit === Number.POSITIVE_INFINITY ? '∞' : naira(currentLimit)}
                    </div>
                    <div className="text-chips font-medium text-brand-fg">Limit ({paymentOption})</div>
                  </div>
                </div>

                {paymentOption === 'Loan' && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg/60 p-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" strokeWidth={2} />
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-warning-fg">Loan Payment</h4>
                      <p className="mt-0.5 text-xs text-warning-fg">
                        Total with interest: <strong>{naira(totalWithInterest)}</strong> ({loanRatePct}% applied)
                      </p>
                    </div>
                  </div>
                )}

                {overLimit && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg/60 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-fg" strokeWidth={2} />
                    <p className="text-xs font-medium text-danger-fg">
                      Total exceeds {paymentOption} limit. Reduce quantities or switch payment method.
                    </p>
                  </div>
                )}

                {message && (
                  <div className={[
                    'mt-3 rounded-lg border p-3 text-xs font-medium',
                    message.type === 'success'
                      ? 'border-success-border bg-success-bg/60 text-success-fg'
                      : 'border-danger-border bg-danger-bg/60 text-danger-fg',
                  ].join(' ')}>
                    {message.text}
                  </div>
                )}

                {!!submitDisabledReason && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg/60 p-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" strokeWidth={2} />
                    <p className="text-xs font-medium text-warning-fg">{submitDisabledReason}</p>
                  </div>
                )}

                <Button
                  size="lg"
                  className="mt-4 w-full"
                  disabled={!canSubmit || submitting}
                  loading={submitting}
                  leftIcon={Check}
                  onClick={submitOrder}
                >
                  {submitting ? 'Submitting…' : 'Submit Order'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function ExhibitionCartPage() {
  return <ExhibitionCartContent />
}
