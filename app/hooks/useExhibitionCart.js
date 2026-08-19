'use client'

// app/hooks/useExhibitionCart.js
// The exhibition cart's owning state — localStorage `exhibitionCart_<memberId>`,
// adopted + announced through useCartCount so every surface (shop, all-products
// page, vendor hub, cart page, Navbar badge) stays live-synced with no
// per-page storage listeners.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import useCartCount from './useCartCount'
import { touchCart } from '@/lib/cartTouch'

export default function useExhibitionCart() {
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()
  const { announceCart, onChange: onCartChange } = useCartCount('exhibition', { memberId })
  const [cart, setCart] = useState([])

  // Mount-time adoption + live cross-surface sync — the hook delivers the
  // stored cart on mount and whenever it changes from another surface or tab.
  // Own-announce echoes are skipped by the hook, so persistCart never
  // re-enters here; the equality guard keeps no-op adoptions from re-rendering.
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
              Number(prev[i]?.qty) === Number(l.qty)
          )
        return same ? prev : next
      })
    })
  }, [memberId, onCartChange])

  const persistCart = (next) => {
    setCart(next)
    try {
      localStorage.setItem(`exhibitionCart_${memberId}`, JSON.stringify(next))
      touchCart('exhibition', memberId)
    } catch {}
    announceCart(next.reduce((s, l) => s + (Number(l?.qty) || 0), 0))
  }

  const addToCart = (p, delta) => {
    const existing = cart.find((l) => l.product_id === p.id)
    const current = existing?.qty || 0
    const nextQty = Math.max(0, current + delta)
    if (nextQty === 0) {
      persistCart(cart.filter((l) => l.product_id !== p.id))
      return
    }
    persistCart([
      ...cart.filter((l) => l.product_id !== p.id),
      {
        product_id: p.id,
        vendor_id: p.vendor_id,
        vendor_name: p.vendor_name,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        price: p.price,
        negotiated: p.negotiated,
        image_url: p.image_url,
        qty: nextQty,
      },
    ])
  }

  const qtyOf = (id) => cart.find((l) => l.product_id === id)?.qty || 0
  const cartCount = useMemo(() => cart.reduce((s, l) => s + l.qty, 0), [cart])
  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.price * l.qty, 0), [cart])

  return { cart, addToCart, qtyOf, cartCount, cartTotal }
}
