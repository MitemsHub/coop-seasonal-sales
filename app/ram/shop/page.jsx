'use client'

import { useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ProtectedRoute from '../../components/ProtectedRoute'
import { useAuth } from '../../contexts/AuthContext'
import DraggableModal from '../../components/DraggableModal'
import ContinueShoppingBanner from '../../components/ContinueShoppingBanner'
import ModuleClosedPanel from '../../components/ModuleClosedPanel'
import { supabase } from '@/lib/supabaseClient'
import { touchCart } from '@/lib/cartTouch'
import useCartCount from '../../hooks/useCartCount'
import { computeRamOrderState } from '@/lib/ramOrderMath'
import { AnimatePresence, motion } from 'framer-motion'

function RamShopPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()

  const memberId = user?.id || ''

  // Live cart-count wiring: the qty stepper IS the ram cart, so every persist
  // (and the post-order reset) announces the new qty so the Navbar badge and
  // other surfaces update instantly instead of waiting on a poll.
  const memberIdKey = memberId ? String(memberId).trim().toUpperCase() : ''
  const { announceCart, onChange: onCartChange } = useCartCount('ram', { memberId: memberIdKey })

  useEffect(() => {
    const mid = (searchParams.get('mid') || '').trim()
    if (mid) router.replace('/ram/shop')
  }, [router, searchParams])

  const [member, setMember] = useState(null)
  const [eligibility, setEligibility] = useState(null)
  const [deliveryLocations, setDeliveryLocations] = useState([])
  const [deliveryLocationId, setDeliveryLocationId] = useState('')
  const [paymentOption, setPaymentOption] = useState('')
  const [qty, setQty] = useState('')
  const [selectedRamCategory, setSelectedRamCategory] = useState('')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [shoppingOpen, setShoppingOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState(null)
  const [popupText, setPopupText] = useState('')
  const retireePopupKeyRef = useRef('')
  const submitLockRef = useRef(false)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [phoneSaving, setPhoneSaving] = useState(false)

  const qtyNumber = Number(qty)
  const safeQty = Number.isFinite(qtyNumber) ? Math.trunc(qtyNumber) : 0

  useEffect(() => {
    try {
      if (!memberId) return
      // Untouched initial state — don't clobber a stored cart with 0 on
      // mount before the cart adoption restores it. The steppers only ever set
      // qty to a stringified number (never ''), so this only gates the mount
      // write.
      if (qty === '') return
      localStorage.setItem(`ramCart_${String(memberId).trim().toUpperCase()}`, JSON.stringify({ qty: Math.max(0, Number(safeQty || 0)) }))
      touchCart('ram', String(memberId).trim().toUpperCase())
      announceCart(safeQty)
    } catch {}
  }, [memberId, safeQty, announceCart])

  // Cart adoption + live sync — the hook delivers the stored ram qty on mount
  // (restoring the member's cart) and whenever it changes from another
  // surface or tab. Own-announce echoes are skipped by the hook, and the
  // equality guard never clobbers the empty state.
  useEffect(() => {
    if (!memberIdKey) return
    return onCartChange((value) => {
      const stored = Number(value?.qty || 0)
      if (!Number.isFinite(stored)) return
      setQty((prev) => {
        const cur = Number(prev || 0)
        return cur === stored ? prev : String(stored)
      })
    })
  }, [memberIdKey, onCartChange])

  const unitPrice = Number(eligibility?.pricing?.unit_price || 0)
  const interestRate = Number.isFinite(Number(eligibility?.rules?.loan_interest_rate)) ? Number(eligibility?.rules?.loan_interest_rate) : 0
  const interestRatePct = Number.isFinite(Number(eligibility?.rules?.loan_interest_rate_pct))
    ? Number(eligibility?.rules?.loan_interest_rate_pct)
    : Math.round(interestRate * 10000) / 100

  // Sticky bar stats + Place Order gating — pure math in lib/ramOrderMath so
  // the numbers and disabled reasons are unit-tested exactly as rendered.
  const ramState = computeRamOrderState({
    safeQty,
    paymentOption,
    deliveryLocationId,
    shoppingOpen,
    submitting,
    unitPrice,
    interestRate,
    eligibility,
    member,
  })
  const {
    principal,
    interest,
    total,
    maxRamsAllowed,
    savingsEligible,
    loanEligible,
    remainingLoanQtyThisCycle,
    isRetiree,
    isPensioner,
    savingsBalance,
    loansBalance,
    phoneMissing,
    allowLoanGrace,
    qtyCapApplies,
    qtyExceeded,
    maxStepperQty,
    loanShortfall,
    savingsIncreaseNeeded,
    minLoanSavingsIncreaseNeeded,
    notEligibleForPayment,
    placeOrderDisabledReason,
    canPlaceOrder,
  } = ramState

  const derivedRamCategory = String(eligibility?.member?.derived_ram_category || eligibility?.member?.ram_category || '')
  const canOverrideRamCategory =
    (paymentOption === 'Cash' || paymentOption === 'Savings') && (paymentOption !== 'Savings' || savingsEligible > 0)

  const selectedLocation = useMemo(() => {
    const idNum = Number(deliveryLocationId)
    if (!Number.isFinite(idNum) || idNum <= 0) return null
    return deliveryLocations.find((l) => Number(l.id) === idNum) || null
  }, [deliveryLocationId, deliveryLocations])

  useEffect(() => {
    if (paymentOption !== 'Loan') return
    if (!Number.isFinite(safeQty) || safeQty <= 0) return
    if (!Number.isFinite(savingsIncreaseNeeded) || savingsIncreaseNeeded <= 0) return
    if (allowLoanGrace) return

    const nextText = `Your purchase will exceed your loan limit by ₦${Number(loanShortfall).toLocaleString()}. Increase savings by ₦${Number(savingsIncreaseNeeded).toLocaleString()} to qualify.`
    const key = `${paymentOption}|${safeQty}|${loanEligible}|${unitPrice}|${savingsIncreaseNeeded}`
    if (retireePopupKeyRef.current === key) return
    retireePopupKeyRef.current = key
    setPopupText(nextText)
  }, [allowLoanGrace, loanEligible, loanShortfall, paymentOption, safeQty, savingsIncreaseNeeded, unitPrice])

  useEffect(() => {
    if (paymentOption !== 'Loan') return
    if (!Number.isFinite(safeQty) || safeQty !== 0) return
    if (!Number.isFinite(minLoanSavingsIncreaseNeeded) || minLoanSavingsIncreaseNeeded <= 0) return
    if (remainingLoanQtyThisCycle <= 0) return
    if (allowLoanGrace) return
    if (maxRamsAllowed > 0) return

    const nextText = `You are not eligible for a 1-ram loan purchase yet. Increase savings by ₦${Number(minLoanSavingsIncreaseNeeded).toLocaleString()} to qualify.`
    const key = `min1|${paymentOption}|${loanEligible}|${unitPrice}|${minLoanSavingsIncreaseNeeded}`
    if (retireePopupKeyRef.current === key) return
    retireePopupKeyRef.current = key
    setPopupText(nextText)
  }, [allowLoanGrace, loanEligible, maxRamsAllowed, minLoanSavingsIncreaseNeeded, paymentOption, remainingLoanQtyThisCycle, safeQty, unitPrice])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!memberId) return
      setLoading(true)
      setMessage(null)
      try {
        const shoppingRes = await fetch('/api/system/ram-shopping', { cache: 'no-store' })
        const shoppingJson = await shoppingRes.json().catch(() => null)
        const open = !!(shoppingRes.ok && shoppingJson?.ok && shoppingJson.open)
        if (!cancelled) setShoppingOpen(open)
        if (!open) {
          if (!cancelled) setMessage({ type: 'error', text: 'Ram shopping is currently closed. Please check back later.' })
          if (!cancelled) setMember(null)
          if (!cancelled) setEligibility(null)
          if (!cancelled) setDeliveryLocations([])
          return
        }

        const { data: memberData, error: mErr } = await supabase
          .from('members')
          .select('member_id,full_name,grade,savings,loans,global_limit,phone')
          .eq('member_id', memberId)
          .single()

        if (mErr || !memberData) {
          if (!cancelled) setMessage({ type: 'error', text: 'Member not found' })
          if (!cancelled) setMember(null)
          return
        }
        if (!cancelled) setMember(memberData)
        if (!cancelled) setPhoneDraft(String(memberData?.phone || ''))

        const res = await fetch(`/api/ram/eligibility?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          if (!cancelled) setMessage({ type: 'error', text: json?.error || 'Failed to load ram eligibility' })
          if (!cancelled) setEligibility(null)
          return
        }
        if (!cancelled) {
          setEligibility(json)
          setSelectedRamCategory(String(json?.member?.ram_category || ''))
          setCategoryTouched(false)
        }

        const locRes = await fetch('/api/ram/delivery-locations', { cache: 'no-store' })
        const locJson = await locRes.json().catch(() => null)
        if (locRes.ok && locJson?.ok && Array.isArray(locJson.locations)) {
          const list = locJson.locations
          if (!cancelled) {
            setDeliveryLocations(list)
            if (list.length === 0) setMessage({ type: 'error', text: 'No ram delivery locations configured yet.' })
          }
        } else {
          if (!cancelled) setDeliveryLocations([])
          if (!cancelled) setMessage({ type: 'error', text: 'Failed to load ram delivery locations.' })
        }
      } catch (e) {
        if (!cancelled) setMessage({ type: 'error', text: e.message || 'Failed to load' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [memberId])

  const savePhone = async () => {
    if (phoneSaving) return
    const phone = String(phoneDraft || '').trim()
    if (!phone) {
      setMessage({ type: 'error', text: 'Please enter a phone number' })
      return
    }
    if (!/^\d{11}$/.test(phone)) {
      setMessage({ type: 'error', text: 'Phone number must be exactly 11 digits' })
      return
    }
    setPhoneSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/members/update-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, phone }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save phone number')
      setMember((prev) => ({ ...(prev || {}), phone: String(json?.member?.phone || phone) }))
      setPhoneDraft(String(json?.member?.phone || phone))
      setMessage({ type: 'success', text: 'Phone number saved' })
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || 'Failed to save phone number' })
    } finally {
      setPhoneSaving(false)
    }
  }

  useEffect(() => {
    if (paymentOption === 'Savings' && savingsEligible <= 0) {
      setPaymentOption('Loan')
    }
  }, [paymentOption, savingsEligible])

  useEffect(() => {
    const run = async () => {
      if (!memberId) return
      if (!categoryTouched) return
      if (!selectedRamCategory) return
      try {
        const res = await fetch(
          `/api/ram/eligibility?member_id=${encodeURIComponent(memberId)}&ram_category=${encodeURIComponent(selectedRamCategory)}`,
          { cache: 'no-store' }
        )
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) return
        setEligibility(json)
      } catch {}
    }
    run()
  }, [categoryTouched, memberId, selectedRamCategory])

  useEffect(() => {
    const run = async () => {
      if (paymentOption !== 'Loan') return
      if (!memberId) return
      const derived = derivedRamCategory
      if (!derived) return
      if (selectedRamCategory !== derived) setSelectedRamCategory(derived)
      if (categoryTouched) setCategoryTouched(false)
      try {
        const res = await fetch(
          `/api/ram/eligibility?member_id=${encodeURIComponent(memberId)}&ram_category=${encodeURIComponent(derived)}`,
          { cache: 'no-store' }
        )
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) return
        setEligibility(json)
      } catch {}
    }
    run()
  }, [categoryTouched, derivedRamCategory, memberId, paymentOption, selectedRamCategory])

  const placeOrder = async () => {
    if (submitLockRef.current) return
    setMessage(null)

    const memberPhone = String(member?.phone || '').trim()
    if (!memberPhone) {
      setMessage({ type: 'error', text: 'Phone number is required. Please enter and save your phone number before placing an order.' })
      return
    }

    if (!paymentOption) {
      setMessage({ type: 'error', text: 'Please select a payment option' })
      return
    }

    if (!Number.isFinite(safeQty) || safeQty <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid quantity' })
      return
    }

    if (!deliveryLocationId) {
      setMessage({ type: 'error', text: 'Please select a delivery location' })
      return
    }

    if (qtyExceeded) {
      setMessage({ type: 'error', text: `Maximum allowed is ${maxRamsAllowed} ram(s) for ${paymentOption}` })
      return
    }

    if (paymentOption === 'Loan' && !allowLoanGrace && savingsIncreaseNeeded > 0) {
      setPopupText(
        `Your purchase will exceed your loan limit by ₦${Number(loanShortfall).toLocaleString()}. Increase savings by ₦${Number(savingsIncreaseNeeded).toLocaleString()} to qualify.`
      )
      return
    }

    if (paymentOption === 'Savings' && total > savingsEligible) {
      setMessage({ type: 'error', text: 'Insufficient savings eligibility for this purchase' })
      return
    }
    if (paymentOption === 'Loan' && principal > loanEligible && !allowLoanGrace) {
      setMessage({ type: 'error', text: 'Insufficient loan eligibility for this purchase' })
      return
    }

    submitLockRef.current = true
    setSubmitting(true)
    try {
      const res = await fetch('/api/ram/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: memberId,
          payment_option: paymentOption,
          qty: Number(safeQty),
          delivery_location_id: Number(deliveryLocationId),
          ...(canOverrideRamCategory && selectedRamCategory ? { ram_category: selectedRamCategory } : {}),
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        const errText = String(json?.error || 'Failed to place order')
        if (errText.toLowerCase().includes('increase savings by')) {
          setPopupText(errText)
        } else {
          setMessage({ type: 'error', text: errText })
        }
        return
      }

      try {
        localStorage.setItem(`ramCart_${String(memberId).trim().toUpperCase()}`, JSON.stringify({ qty: 0 }))
        touchCart('ram', String(memberId).trim().toUpperCase())
        announceCart(0)
      } catch {}

      router.push(`/ram/success/${encodeURIComponent(json.order.id)}`)
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Network error' })
    } finally {
      setSubmitting(false)
      submitLockRef.current = false
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 md:py-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="h-7 w-56 bg-muted rounded-lg animate-pulse" />
              <div className="mt-2 h-4 w-40 bg-muted rounded animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-10 w-28 bg-muted rounded-lg animate-pulse" />
              <div className="h-10 w-24 bg-muted rounded-lg animate-pulse" />
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4"
          >
            <div className="lg:col-span-2 bg-surface rounded-2xl shadow-lg border border-line-subtle p-5 md:p-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-600 to-blue-600 flex items-center justify-center shadow-md">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-fg">Loading Ram Sales</div>
                  <div className="text-xs text-muted">Fetching your eligibility and delivery locations…</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={`sk-card-${i}`} className="bg-subtle rounded-xl p-3">
                    <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                    <div className="mt-2 h-4 w-28 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-subtle rounded-xl p-4 border border-line-subtle">
                  <div className="h-4 w-40 bg-muted rounded animate-pulse" />
                  <div className="mt-3 h-10 w-full bg-muted rounded-xl animate-pulse" />
                </div>
                <div className="bg-subtle rounded-xl p-4 border border-line-subtle">
                  <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                  <div className="mt-3 h-10 w-full bg-muted rounded-xl animate-pulse" />
                </div>
                <div className="md:col-span-2 bg-subtle rounded-xl p-4 border border-line-subtle">
                  <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                  <div className="mt-3 h-10 w-full bg-muted rounded-xl animate-pulse" />
                </div>
              </div>

              <div className="mt-6 h-12 w-full bg-muted rounded-xl animate-pulse" />
            </div>

            <div className="bg-surface rounded-2xl shadow-lg border border-line-subtle p-5 md:p-6">
              <div className="h-4 w-24 bg-muted rounded animate-pulse" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={`sk-line-${i}`} className="flex items-center justify-between gap-3">
                    <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
              <div className="mt-6 h-28 w-full bg-muted rounded-xl animate-pulse" />
            </div>
          </motion.div>
        </div>
      </main>
    )
  }

  // When the Ram module is closed, show the shared closed panel instead of the
  // shopping form.
  if (!shoppingOpen) {
    return (
      <main className="min-h-screen bg-canvas">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>
        <ModuleClosedPanel
          module="ram"
          variant="inline"
          onViewOrders={() => router.push('/orders?tab=ram')}
          onBack={() => router.push('/my-coop')}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 md:py-12">
        <Link
          href="/my-coop"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors duration-200 hover:text-brand"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </Link>
        {/* Continue-shopping banner — surfaces food/exhibition carts here;
            the ram cart is already covered by the sticky bar. */}
        <ContinueShoppingBanner excludeModules={['ram']} className="mb-fluid-lg" />
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[1.0625rem] font-bold text-fg sm:text-h1">
            Ram Sales ({shoppingOpen ? 'Opened' : 'Closed'})
          </h1>
        </div>

        <AnimatePresence mode="wait">
          {message ? (
            <motion.div
              key={`${message.type}-${message.text}`}
              initial={{ opacity: 0, y: -8, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={`mb-4 rounded-xl border p-3 text-sm ${
                message.type === 'error'
                  ? 'bg-danger-bg border-danger-border text-danger-fg'
                  : 'bg-success-bg border-success-border text-success-fg'
              }`}
            >
              {message.text}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <DraggableModal
          open={!!popupText}
          onClose={() => setPopupText('')}
          title="Loan Limit"
          overlayClassName="bg-black/40"
          footer={
            <div className="flex justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
                onClick={() => setPopupText('')}
              >
                OK
              </button>
            </div>
          }
        >
          <div className="text-sm text-fg">{popupText}</div>
        </DraggableModal>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="lg:col-span-2 bg-surface rounded-2xl shadow-lg border border-line-subtle p-5 md:p-6"
          >
            <div className="text-sm font-semibold text-fg">Member</div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <div className="bg-subtle rounded-xl p-2">
                <div className="text-chips text-muted">Full Name</div>
                <div className="font-semibold text-sm text-fg">{member?.full_name || '—'}</div>
              </div>
              <div className="bg-subtle rounded-xl p-2">
                <div className="text-chips text-muted">Grade</div>
                <div className="font-semibold text-sm text-fg">{eligibility?.member?.grade || member?.grade || '—'}</div>
              </div>
              <div className="bg-subtle rounded-xl p-2">
                <div className="text-chips text-muted">Savings</div>
                <div className="font-semibold text-sm text-fg">₦{Number(savingsBalance || 0).toLocaleString()}</div>
              </div>
              <div className="bg-subtle rounded-xl p-2">
                <div className="text-chips text-muted">Loans</div>
                <div className="font-semibold text-sm text-fg">₦{Number(loansBalance || 0).toLocaleString()}</div>
              </div>
              <div className="bg-subtle rounded-xl p-2">
                <div className="text-chips text-muted">Phone</div>
                {String(member?.phone || '').trim() ? (
                  <div className="font-semibold text-sm text-fg">{String(member?.phone || '').trim()}</div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      className="w-full border rounded-lg px-2 py-1 text-sm bg-surface"
                      placeholder="Enter phone number"
                      value={phoneDraft}
                      onChange={(e) => {
                        const digitsOnly = String(e.target.value || '').replace(/\D/g, '').slice(0, 11)
                        setPhoneDraft(digitsOnly)
                      }}
                      inputMode="numeric"
                      pattern="[0-9]{11}"
                      maxLength={11}
                      disabled={phoneSaving}
                    />
                    <button
                      type="button"
                      className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
                      onClick={savePhone}
                      disabled={phoneSaving || String(phoneDraft || '').trim().length !== 11}
                    >
                      {phoneSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
              <div className="bg-subtle rounded-xl p-2">
                <div className="text-chips text-muted">Ram Category</div>
                {canOverrideRamCategory ? (
                  <select
                    value={selectedRamCategory || derivedRamCategory || ''}
                    onChange={(e) => {
                      setCategoryTouched(true)
                      setSelectedRamCategory(e.target.value)
                    }}
                    className="mt-1 w-full border-2 border-line-subtle rounded-xl px-3 py-1.5 focus:border-green-600 focus:ring-2 focus:ring-green-200 transition-all duration-200 text-sm bg-surface"
                  >
                    <option value="Junior">Junior</option>
                    <option value="Senior">Senior</option>
                    <option value="Executive">Executive</option>
                  </select>
                ) : (
                  <div className="font-semibold text-sm text-fg">{derivedRamCategory || '—'}</div>
                )}
              </div>
              <div className="bg-subtle rounded-xl p-2">
                <div className="text-chips text-muted">Unit Price per Category</div>
                <div className="font-semibold text-sm text-fg">₦{unitPrice.toLocaleString()}</div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">How do you want to pay</label>
                <select
                  value={paymentOption}
                  onChange={(e) => setPaymentOption(e.target.value)}
                  className="w-full border-2 border-line-subtle rounded-xl px-3 py-2 focus:border-green-600 focus:ring-2 focus:ring-green-200 transition-all duration-200 text-sm"
                >
                  <option value="" disabled>
                    Select payment option
                  </option>
                  <option value="Loan">Loan ({interestRatePct}% interest)</option>
                  <option value="Savings" disabled={savingsEligible <= 0}>Savings {savingsEligible <= 0 ? '(Not eligible)' : ''}</option>
                  <option value="Cash">Cash (Unlimited)</option>
                </select>
                <div className="mt-2 text-xs text-muted">
                  Savings Eligible: ₦{savingsEligible.toLocaleString()} · Loan Eligible: ₦{loanEligible.toLocaleString()}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Quantity</label>
                <div
                  className={`grid grid-cols-[44px_1fr_44px] items-center rounded-xl border-2 bg-surface ${
                    qtyExceeded ? 'border-red-400' : 'border-line-subtle'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setQty(String(Math.max(0, safeQty - 1)))}
                    disabled={submitting || safeQty <= 0}
                    className="h-11 w-11 inline-flex items-center justify-center rounded-l-xl text-muted hover:bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <div className="h-11 flex items-center justify-center text-sm font-semibold text-fg tabular-nums">
                    {safeQty || 0}
                  </div>
                  <button
                    type="button"
                    onClick={() => setQty(String(Math.min(maxStepperQty, Math.max(0, safeQty) + 1)))}
                    disabled={submitting || safeQty >= maxStepperQty}
                    className="h-11 w-11 inline-flex items-center justify-center rounded-r-xl text-muted hover:bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
                <div className={`mt-2 text-xs ${qtyExceeded ? 'text-danger-fg' : 'text-muted'}`}>
                  {paymentOption ? (
                    paymentOption === 'Cash' ? (
                      <>Max (UI): {maxStepperQty} ram(s)</>
                    ) : (
                      <>Max for {paymentOption}: {maxRamsAllowed} ram(s)</>
                    )
                  ) : (
                    <>Select payment option to see your max quantity</>
                  )}
                </div>
                {paymentOption === 'Loan' && savingsIncreaseNeeded > 0 && (
                  <div className="mt-2 text-xs text-danger-fg">
                    Increase savings by ₦{Number(savingsIncreaseNeeded).toLocaleString()} to qualify for this loan purchase.
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                {paymentOption === 'Savings' && savingsEligible > 0 && (
                  <div className="p-4 bg-success-bg border border-success-border rounded-xl">
                    <div className="flex items-start">
                      <svg
                        className="w-5 h-5 text-green-600 mr-3 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-success-fg mb-2">Savings Payment Information</div>
                        <div className="text-sm text-success-fg">
                          Members can only use 50% of their total savings balance for purchases. Your current available savings
                          limit is ₦{savingsEligible.toLocaleString()}.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {paymentOption === 'Loan' && (
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl">
                    <div className="flex items-start">
                      <svg
                        className="w-5 h-5 text-orange-600 mr-3 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-orange-800 mb-2">Loan Payment Information</div>
                        <div className="text-sm text-orange-700">
                          Interest Rate: A {interestRatePct}% interest will be charged on all ram purchases using the loan payment option.
                        </div>
                        <div className="text-sm text-orange-700 mt-2">
                          Loan purchase is limited to a maximum of 2 rams per member per ram cycle. Once exhausted, you cannot shop
                          again using loan for this cycle.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {paymentOption === 'Cash' && (
                  <div className="p-4 bg-info-bg border border-info-border rounded-xl">
                    <div className="flex items-start">
                      <svg
                        className="w-5 h-5 text-info-fg mr-3 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <div className="min-w-0 w-full">
                        <div className="text-sm font-semibold text-info-fg mb-2">Cash Payment Instructions</div>
                        <div className="text-sm text-info-fg mb-3">
                          After placing your order, kindly send your payment receipt to the Cooperative (09061388502) for
                          verification.
                        </div>
                        <div className="mb-3 p-3 bg-surface border border-info-border rounded-lg w-full">
                          <div className="text-xs font-semibold text-muted mb-1">Bank Transfer Details</div>
                          <div className="text-sm text-fg">Fidelity Bank</div>
                          <div className="text-sm text-fg">Account Number: 5080056982</div>
                          <div className="text-sm text-fg">Account Name: CBN Staff Multipurpose Coop. Soc. Ltd.</div>
                        </div>
                        <a
                          href="https://wa.me/+2349061388502"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors duration-200"
                        >
                          <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.097z" />
                          </svg>
                          Send Receipt via WhatsApp
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Delivery Location</label>
                <select
                  value={deliveryLocationId}
                  onChange={(e) => setDeliveryLocationId(e.target.value)}
                  className="w-full border-2 border-line-subtle rounded-xl px-3 py-2 focus:border-green-600 focus:ring-2 focus:ring-green-200 transition-all duration-200 text-sm"
                >
                  <option value="" disabled>
                    Select delivery location
                  </option>
                  {deliveryLocations.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.delivery_location || l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!!placeOrderDisabledReason && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                {placeOrderDisabledReason}
              </div>
            )}

            <motion.button
              type="button"
              onClick={placeOrder}
              disabled={
                !canPlaceOrder
              }
              className={`mt-6 w-full inline-flex items-center justify-center px-4 py-3 text-white text-sm md:text-base font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl ${
                !canPlaceOrder
                  ? 'bg-subtle text-muted cursor-not-allowed'
                  : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
              }`}
              whileHover={{
                y:
                  !canPlaceOrder
                    ? 0
                    : -1,
              }}
              whileTap={{ scale: 0.985 }}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Submitting...</span>
                </span>
              ) : (
                'Place Order'
              )}
            </motion.button>

            <div className="sticky bottom-2 z-10 mt-6 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur-sm md:bottom-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid flex-1 grid-cols-3 gap-2">
                  <div className="rounded-xl bg-subtle/70 px-3 py-2 text-center">
                    <div className="text-chips font-medium text-muted">Rams</div>
                    <div className="text-sm font-semibold tabular-nums text-fg">{Number(safeQty || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl bg-subtle/70 px-3 py-2 text-center">
                    <div className="text-chips font-medium text-muted">Total</div>
                    <div className="text-sm font-semibold tabular-nums text-fg">₦{total.toLocaleString()}</div>
                    {paymentOption === 'Loan' && interest > 0 && (
                      <div className="text-chips font-medium text-muted">incl. ₦{interest.toLocaleString()} interest</div>
                    )}
                  </div>
                  <div className={['rounded-xl px-3 py-2 text-center', qtyExceeded ? 'bg-danger-bg' : 'bg-subtle/70'].join(' ')}>
                    <div className={['text-chips font-medium', qtyExceeded ? 'text-danger-fg' : 'text-muted'].join(' ')}>Max</div>
                    <div className={['text-sm font-semibold tabular-nums', qtyExceeded ? 'text-danger-fg' : 'text-fg'].join(' ')}>
                      {paymentOption === 'Cash' ? 'No limit' : `${Number(maxRamsAllowed || 0).toLocaleString()} ram(s)`}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={placeOrder}
                  disabled={
                    !canPlaceOrder
                  }
                  className={`relative inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg transition-all duration-200 sm:w-auto sm:flex-none ${
                    !canPlaceOrder
                      ? 'bg-subtle text-muted cursor-not-allowed'
                      : 'bg-gradient-to-r from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700'
                  }`}
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Submitting...</span>
                    </span>
                  ) : (
                    'Place Order'
                  )}
                  {safeQty > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold tabular-nums text-accent-fg shadow-sm">
                      {safeQty}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut', delay: 0.03 }}
            className="bg-surface rounded-2xl shadow-lg border border-line-subtle p-5 md:p-6"
          >
            <div className="text-sm font-semibold text-fg">Summary</div>
            <div className="mt-3 space-y-2 text-sm text-muted">
              <div className="flex items-center justify-between">
                <div>Quantity</div>
                  <div className="font-semibold">{Number(safeQty || 0).toLocaleString()}</div>
              </div>
              <div className="flex items-center justify-between">
                <div>Unit Price per Category</div>
                <div className="font-semibold">₦{unitPrice.toLocaleString()}</div>
              </div>
              <div className="flex items-center justify-between">
                <div>Principal</div>
                <div className="font-semibold">₦{principal.toLocaleString()}</div>
              </div>
              <div className="flex items-center justify-between">
                <div>Interest</div>
                <div className="font-semibold">₦{interest.toLocaleString()}</div>
              </div>
              <div className="pt-2 border-t border-line-subtle flex items-center justify-between">
                <div className="font-semibold">Total</div>
                <div className="font-bold text-fg">₦{total.toLocaleString()}</div>
              </div>
            </div>

            <div className="mt-6">
              <div className="text-sm font-semibold text-fg">Vendor Details</div>
              <div className="mt-3 space-y-2 text-sm text-muted">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted">Name</div>
                  <div className="font-semibold text-right break-words">{selectedLocation?.name || '—'}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted">Phone No</div>
                  <div className="font-semibold text-right break-words">{selectedLocation?.phone || '—'}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-muted">Address</div>
                  <div className="font-semibold text-right break-words">{selectedLocation?.address || '—'}</div>
                </div>
              </div>
            </div>

            {!!eligibility?.eligibility?.ramOrdersTableMissing && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Ram Sales tables are not created yet in the database. Orders will fail until the migration is applied.
              </div>
            )}
          </motion.div>
        </motion.div>
      </div>
    </main>
  )
}

export default function RamShopPage() {
  return (
    <ProtectedRoute allowedRoles={['member']}>
      <Suspense>
        <RamShopPageContent />
      </Suspense>
    </ProtectedRoute>
  )
}
