// app/components/ContinueShoppingBanner.jsx
// Surfaces the most recently touched in-progress cart (Food, Ram, or
// Exhibition) with one-tap jumps back into the shop or straight to checkout.
//
// Props:
//   excludeModules — modules to skip (e.g. ['exhibition'] on pages whose own
//                    sticky cart bar already covers the exhibition cart).
//   className      — extra classes for the wrapper.
//   compact       — render the one-line variant (module icon · count/total ·
//                   chevron) for tight surfaces like the mobile drawer.
//   onNavigate    — fired before navigating in compact mode (e.g. close a
//                   drawer), so taps behave like the page's own links.
//
// The banner is session-dismissible: the X hides it for the tab/session via
// sessionStorage while the carts themselves stay intact in localStorage.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Beef, ShoppingBasket, ShoppingCart, Store, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import useCartCount from '../hooks/useCartCount'
import { getCartTouch } from '@/lib/cartTouch'
import Button from '../components/ui/Button'

const naira = (v) => `₦${Number(v || 0).toLocaleString()}`

// The canonical per-module icons used across the app (landing page, member
// picker, admin switcher, notifications) so members recognize the cart's
// module at a glance instead of a generic cart.
const MODULE_ICONS = {
  food: ShoppingBasket,
  ram: Beef,
  exhibition: Store,
}

export default function ContinueShoppingBanner({ excludeModules = [], className = '', compact = false, onNavigate = null }) {
  const router = useRouter()
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()

  // Each module's hook owns the live count + its listeners; we re-read the
  // line data (and touch stamps) whenever any cart changes.
  const { count: foodCartCount, onChange: onFoodCartChange } = useCartCount('food', { memberId })
  const { count: ramCartCount, onChange: onRamCartChange } = useCartCount('ram', { memberId })
  const { count: exhCartCount, onChange: onExhCartChange } = useCartCount('exhibition', { memberId })

  const [foodCartLines, setFoodCartLines] = useState([])
  const [exhCartLines, setExhCartLines] = useState([])
  const [ramCartQty, setRamCartQty] = useState(0)
  const [ramUnitPrice, setRamUnitPrice] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  // Adopt food + exhibition line data on mount and on any cart change — the
  // hook delivers the stored value, so the banner never touches localStorage
  // directly (mount-time adoption happens at subscription, so no initial read
  // is needed).
  useEffect(() => {
    if (!memberId) return
    const adoptFood = (value) => {
      setFoodCartLines(Array.isArray(value) ? value.filter((l) => Number(l?.qty) > 0) : [])
    }
    const adoptExh = (value) => {
      setExhCartLines(Array.isArray(value) ? value.filter((l) => Number(l?.qty) > 0) : [])
    }
    const unsubFood = onFoodCartChange(adoptFood)
    const unsubExh = onExhCartChange(adoptExh)
    return () => {
      unsubFood()
      unsubExh()
    }
  }, [memberId, onFoodCartChange, onExhCartChange])

  // Adopt the ram cart qty the same way — the hook delivers the stored
  // { qty } value, so no count-keyed storage re-read.
  useEffect(() => {
    if (!memberId) return
    return onRamCartChange((value) => {
      setRamCartQty(Math.max(0, Math.trunc(Number(value?.qty || 0))))
    })
  }, [memberId, onRamCartChange])

  // Session-scoped dismiss. Cart data stays intact in localStorage; the X
  // only hides the banner for this session. The flag is shared across pages.
  useEffect(() => {
    if (!memberId) return
    try {
      setDismissed(sessionStorage.getItem(`continueShoppingDismissed_${memberId}`) === '1')
    } catch {}
  }, [memberId])

  const dismissBanner = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(`continueShoppingDismissed_${memberId}`, '1')
    } catch {}
  }

  // Ram unit price (grade-dependent) — fetched only when a live ram cart
  // needs a total.
  useEffect(() => {
    if (!memberId || ramCartQty <= 0 || ramUnitPrice != null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/ram/eligibility?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!cancelled) {
          const price = Number(json?.pricing?.unit_price || 0)
          setRamUnitPrice(price > 0 ? price : null)
        }
      } catch {
        // optional — the ram banner shows the count without a total
      }
    })()
    return () => { cancelled = true }
  }, [memberId, ramCartQty, ramUnitPrice])

  const foodCartTotal = foodCartLines.reduce((s, l) => s + Number(l?.price || 0) * Number(l?.qty || 0), 0)
  const exhCartTotal = exhCartLines.reduce((s, l) => s + Number(l?.price || 0) * Number(l?.qty || 0), 0)
  const ramCartTotal = ramCartQty > 0 && ramUnitPrice ? ramCartQty * ramUnitPrice : null

  // The most recently touched non-empty cart drives the banner. When nothing
  // is stamped yet, fall back in a fixed order (skipping excluded modules).
  const activeCart = useMemo(() => {
    const exclude = new Set(excludeModules)
    const carts = [
      { module: 'food', count: Number(foodCartCount) || 0, touch: getCartTouch('food', memberId) },
      { module: 'ram', count: Number(ramCartCount) || 0, touch: getCartTouch('ram', memberId) },
      { module: 'exhibition', count: Number(exhCartCount) || 0, touch: getCartTouch('exhibition', memberId) },
    ]
      .filter((c) => !exclude.has(c.module) && c.count > 0)
    if (carts.length === 0) return null
    const maxTouch = Math.max(...carts.map((c) => c.touch))
    if (maxTouch > 0) return carts.reduce((a, b) => (b.touch > a.touch ? b : a))
    const fallbackOrder = ['exhibition', 'food', 'ram'].filter((m) => !exclude.has(m))
    return carts.find((c) => c.module === fallbackOrder[0]) || carts.find((c) => c.module === fallbackOrder[1]) || carts[0]
  }, [foodCartCount, ramCartCount, exhCartCount, memberId, excludeModules])

  if (!activeCart || dismissed) return null

  const isRam = activeCart.module === 'ram'
  const ModuleIcon = MODULE_ICONS[activeCart.module] || ShoppingCart
  const shopHref = activeCart.module === 'food' ? '/shop' : '/exhibition'
  const checkoutHref = activeCart.module === 'food' ? '/cart' : '/exhibition/cart'

  // Compact one-line variant for tight surfaces (e.g. the mobile drawer):
  // module icon · truncated count/total · chevron. Tapping jumps into the
  // cart's module (shop for ram, checkout otherwise) and fires onNavigate.
  if (compact) {
    const label =
      activeCart.module === 'food'
        ? `${activeCart.count.toLocaleString()} item${activeCart.count === 1 ? '' : 's'} in Food`
        : activeCart.module === 'ram'
          ? `${activeCart.count.toLocaleString()} ram${activeCart.count === 1 ? '' : 's'} in Ram`
          : `${activeCart.count.toLocaleString()} item${activeCart.count === 1 ? '' : 's'} in Exhibition`
    const total =
      activeCart.module === 'ram' ? (ramCartTotal != null ? naira(ramCartTotal) : null) : activeCart.module === 'food' ? naira(foodCartTotal) : naira(exhCartTotal)
    const target = isRam ? '/ram/shop' : checkoutHref
    return (
      <button
        type="button"
        onClick={() => {
          onNavigate?.()
          router.push(target)
        }}
        aria-label={`${label}${total ? ` · ${total}` : ''} — continue shopping`}
        className={`flex w-full items-center gap-2.5 rounded-xl border border-accent/25 bg-accent-subtle/40 px-3 py-2 text-left transition-colors duration-200 hover:bg-accent-subtle/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-fg">
          <ModuleIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
          {label}
          {total ? <span className="text-muted"> · {total}</span> : null}
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2.2} />
      </button>
    )
  }

  return (
    <div
      className={`relative flex flex-col gap-3 rounded-2xl border border-accent/25 bg-accent-subtle/40 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 ${className}`}
    >
      <button
        onClick={dismissBanner}
        aria-label="Hide continue shopping banner"
        title="Hide for this session"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.2} />
      </button>
      <div className="flex min-w-0 items-center gap-3 pr-8">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-fg">
          <ModuleIcon className="h-4.5 w-4.5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">
            {activeCart.module === 'food' && (
              <>{activeCart.count.toLocaleString()} item{activeCart.count === 1 ? '' : 's'} in your Food cart</>
            )}
            {activeCart.module === 'ram' && (
              <>{activeCart.count.toLocaleString()} ram{activeCart.count === 1 ? '' : 's'} in your Ram sales cart</>
            )}
            {activeCart.module === 'exhibition' && (
              <>{activeCart.count.toLocaleString()} item{activeCart.count === 1 ? '' : 's'} in your Exhibition cart</>
            )}
          </p>
          <p className="mt-0.5 truncate text-chips text-muted">
            {activeCart.module === 'food' && <>Total · {naira(foodCartTotal)}</>}
            {activeCart.module === 'ram' && (ramCartTotal != null ? <>Total · {naira(ramCartTotal)}</> : 'Purchase on the Ram shop')}
            {activeCart.module === 'exhibition' && <>Total · {naira(exhCartTotal)}</>}
          </p>
        </div>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        {isRam ? (
          <Button variant="accent" size="sm" rightIcon={ArrowRight} onClick={() => router.push('/ram/shop')} className="w-full sm:w-auto">
            Purchase rams
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={ShoppingCart}
              onClick={() => router.push(shopHref)}
              className="w-full sm:w-auto"
            >
              Continue shopping
            </Button>
            <Button
              variant="accent"
              size="sm"
              rightIcon={ArrowRight}
              onClick={() => router.push(checkoutHref)}
              className="w-full sm:w-auto"
            >
              Go to checkout
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
