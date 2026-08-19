'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useAuth } from '../contexts/AuthContext'
import useCartCount from '../hooks/useCartCount'
import { Beef, ShoppingCart } from 'lucide-react'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

function RamPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const [shoppingOpen, setShoppingOpen] = useState(true)
  const [foodShoppingOpen, setFoodShoppingOpen] = useState(true)
  const [shoppingStatusLoading, setShoppingStatusLoading] = useState(false)

  const memberId = user?.id || ''
  const memberIdKey = memberId ? String(memberId).trim().toUpperCase() : ''

  // Live ram cart wiring — same hook the shop and Navbar badge use, so the
  // mini summary adopts the stored qty on mount and stays in sync across tabs
  // and surfaces.
  const { onChange: onRamCartChange } = useCartCount('ram', { memberId: memberIdKey })
  const [ramCartQty, setRamCartQty] = useState(0)
  const [ramUnitPrice, setRamUnitPrice] = useState(null)

  // Adopt the cart qty on mount and on any ram-cart change — the hook
  // delivers the stored { qty } value (mount-time adoption happens at
  // subscription), so no direct localStorage read here.
  useEffect(() => {
    if (!memberIdKey) return
    return onRamCartChange((value) => {
      setRamCartQty(Math.max(0, Math.trunc(Number(value?.qty || 0))))
    })
  }, [memberIdKey, onRamCartChange])

  // Resolve the member's unit price only when a live cart needs it.
  useEffect(() => {
    if (!memberIdKey || ramCartQty <= 0 || ramUnitPrice != null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/ram/eligibility?member_id=${encodeURIComponent(memberIdKey)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!cancelled) {
          const price = Number(json?.pricing?.unit_price || 0)
          setRamUnitPrice(price > 0 ? price : null)
        }
      } catch {
        // optional — the summary still shows the count without a total
      }
    })()
    return () => { cancelled = true }
  }, [memberIdKey, ramCartQty, ramUnitPrice])

  const ramCartTotal = ramCartQty > 0 && ramUnitPrice ? ramCartQty * ramUnitPrice : null

  useEffect(() => {
    const mid = (searchParams.get('mid') || '').trim()
    if (mid) router.replace('/ram')
  }, [router, searchParams])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setShoppingStatusLoading(true)
        const [ramRes, foodRes] = await Promise.allSettled([
          fetch('/api/system/ram-shopping', { cache: 'no-store' }),
          fetch('/api/system/shopping', { cache: 'no-store' }),
        ])

        if (ramRes.status === 'fulfilled') {
          const json = await ramRes.value.json()
          if (!ramRes.value.ok || !json?.ok) throw new Error(json?.error || 'Failed to load ram shopping status')
          if (!cancelled) setShoppingOpen(!!json.open)
        } else {
          throw new Error(ramRes.reason?.message || 'Failed to load ram shopping status')
        }

        if (foodRes.status === 'fulfilled') {
          const json = await foodRes.value.json()
          if (!foodRes.value.ok || !json?.ok) throw new Error(json?.error || 'Failed to load food shopping status')
          if (!cancelled) setFoodShoppingOpen(!!json.open)
        } else {
          throw new Error(foodRes.reason?.message || 'Failed to load food shopping status')
        }
      } catch {
        if (!cancelled) setShoppingOpen(false)
        if (!cancelled) setFoodShoppingOpen(false)
      } finally {
        if (!cancelled) setShoppingStatusLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
        <div className="ui-card p-6 md:p-8">
          <h1 className="text-h1 font-bold text-fg">Ram Sales ({shoppingOpen ? 'Opened' : 'Closed'})</h1>
          <div className="mt-2 text-sm md:text-base text-muted">
            Member ID: <span className="font-semibold text-fg">{memberId || '—'}</span>
          </div>

          <div className="mt-6 bg-success-bg border border-success-border rounded-xl p-4 text-sm md:text-base text-success-fg">
            This is the Ram Sales module entry page. Nationwide pricing will apply per member category (Junior/Senior/Executive).
          </div>

          {/* Mini cart summary — live qty + estimated total before entering the shop */}
          {ramCartQty > 0 && (
            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-accent/25 bg-accent-subtle/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-fg">
                  <Beef className="h-5 w-5" strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">
                    Your Ram sales cart · {ramCartQty.toLocaleString()} ram{ramCartQty === 1 ? '' : 's'}
                  </p>
                  <p className="mt-0.5 truncate text-chips text-muted">
                    {ramCartTotal != null ? (
                      <>Estimated total · {naira(ramCartTotal)}</>
                    ) : (
                      <>In progress — ready to continue</>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push('/ram/shop')}
                disabled={!shoppingOpen || shoppingStatusLoading}
                className={`inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 sm:w-auto ${
                  shoppingOpen && !shoppingStatusLoading
                    ? 'bg-accent text-white hover:bg-accent-hover shadow-md'
                    : 'bg-subtle text-muted cursor-not-allowed'
                }`}
              >
                <ShoppingCart className="h-4 w-4" />
                Continue purchasing
              </button>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => router.push('/ram/shop')}
              disabled={!shoppingOpen || shoppingStatusLoading}
              className={`w-full inline-flex items-center justify-center px-4 py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl ${
                shoppingOpen && !shoppingStatusLoading
                  ? 'bg-gradient-to-r from-success to-success-600 hover:from-success-700 hover:to-success-700 text-white'
                  : 'bg-subtle text-muted cursor-not-allowed'
              }`}
            >
              {shoppingOpen ? 'Start Ram Shopping' : 'Ram Shopping (Closed)'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/shop')}
              disabled={!foodShoppingOpen || shoppingStatusLoading}
              className={`w-full inline-flex items-center justify-center px-4 py-3 text-sm md:text-base font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl ${
                foodShoppingOpen && !shoppingStatusLoading
                  ? 'bg-gradient-to-r from-brand to-brand-hover hover:from-brand-hover hover:to-brand-700 text-white'
                  : 'bg-subtle text-muted cursor-not-allowed'
              }`}
            >
              {foodShoppingOpen ? 'Go to Food Distribution' : 'Food Distribution (Closed)'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => router.push('/portal')}
            className="mt-3 w-full inline-flex items-center justify-center px-4 py-3 text-fg text-sm md:text-base font-semibold rounded-xl transition-all duration-200 border border-line-strong hover:bg-subtle"
          >
            Back to Portal
          </button>
        </div>
      </div>
    </main>
  )
}

export default function RamPage() {
  return (
    <ProtectedRoute allowedRoles={['member']}>
      <RamPageContent />
    </ProtectedRoute>
  )
}
