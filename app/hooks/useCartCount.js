'use client'

// app/hooks/useCartCount.js
// One place for the cart-count event wiring used by the Navbar badge and every
// shop surface. Each module owns an event name and a localStorage key:
//   food              → 'cart-updated'             / cart_<memberId>
//   exhibition        → 'exhibition-cart-updated'  / exhibitionCart_<memberId>
//   ram               → 'ram-cart-updated'         / ramCart_<memberId>
//   orders            → 'orders-count-updated'     / ordersCount_<memberId>
//   exhibitionPending → 'exhibition-pending-updated' / exhibitionPending_<memberId>
//                       + fresh flag / exhibitionPendingFresh_<memberId>
//
// Consumers:
//   const { count, fresh, announceCart, onChange } = useCartCount('food', { memberId })
//
//   count        — the latest total quantity for this module, kept live by the
//                  module event (same-tab surfaces) and cross-tab storage
//                  changes, plus an initial read.
//   fresh        — optional per-module flag (exhibitionPending) tracking
//                  whether the value is NEW since the consumer last saw it —
//                  powers the Navbar badge's fresh-pulse treatment.
//   announceCart — dispatch the module's event after any mutation, so every
//                  subscribed surface (Navbar badge, sticky bars) updates the
//                  same tick. May carry { qty, fresh } to update both.
//   onChange     — subscribe to the stored value for THIS module; returns an
//                  unsubscribe function. The callback receives the parsed
//                  stored value (array, {qty}, number, or null) and is called
//                  once on mount / member change (mount-time adoption) and on
//                  every external change — another surface's announce or a
//                  cross-tab storage event. It is NOT called for this
//                  instance's own announceCart echoes, so surfaces never
//                  re-adopt (and re-persist) their own writes.
//
// The 'orders' and 'exhibitionPending' modules power the Navbar's order badges
// (the order pages announce after writing their count keys). Their stored
// values are plain numbers, unlike the array/object cart shapes.

import { useCallback, useEffect, useRef, useState } from 'react'

const MODULES = {
  food: { event: 'cart-updated', storageKey: (mid) => `cart_${mid}` },
  ram: { event: 'ram-cart-updated', storageKey: (mid) => `ramCart_${mid}` },
  exhibition: { event: 'exhibition-cart-updated', storageKey: (mid) => `exhibitionCart_${mid}` },
  orders: { event: 'orders-count-updated', storageKey: (mid) => `ordersCount_${mid}` },
  exhibitionPending: {
    event: 'exhibition-pending-updated',
    storageKey: (mid) => `exhibitionPending_${mid}`,
    freshKey: (mid) => `exhibitionPendingFresh_${mid}`,
  },
}

// Parse the module's stored value for subscriber delivery (surfaces shape it
// into their local state — the hook only tracks the count).
function readValue(module, memberId) {
  try {
    if (!memberId) return null
    const raw = localStorage.getItem(MODULES[module].storageKey(memberId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Total quantity currently stored for a module's cart key.
function readCount(module, memberId) {
  try {
    if (!memberId) return 0
    const raw = localStorage.getItem(MODULES[module].storageKey(memberId))
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    // Scalar number keys (orders / exhibitionPending store "5" directly).
    if (typeof parsed === 'number') return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
    if (module === 'ram') {
      const n = Number(parsed?.qty || 0)
      return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
    }
    if (!Array.isArray(parsed)) return 0
    return parsed.reduce((sum, it) => sum + Math.max(0, Number(it?.qty || 0)), 0)
  } catch {
    return 0
  }
}

// The module's optional 'fresh' flag (exhibitionPending) — '1' when the value
// is new since the consumer last saw it.
function readFresh(module, memberId) {
  try {
    if (!memberId) return false
    const fk = MODULES[module]?.freshKey
    if (!fk) return false
    return localStorage.getItem(fk(memberId)) === '1'
  } catch {
    return false
  }
}

export default function useCartCount(module = 'food', { memberId = '' } = {}) {
  const { event, storageKey } = MODULES[module] || MODULES.food
  const freshKey = MODULES[module]?.freshKey || null
  // Neutral defaults — the stored value is read in the mount effect below (not
  // in the useState initializer) so the server render and the first client
  // render agree, avoiding a hydration mismatch on every surface that uses
  // this hook (Navbar badge, sticky cart bars, shop pages).
  const [count, setCount] = useState(0)
  const [fresh, setFresh] = useState(false)
  const subscribers = useRef(new Set())
  // Set right before dispatching our own event so the listener can tell an
  // echo of THIS instance's announce from a genuine external change.
  const ownEchoRef = useRef(false)

  // Announce a new total quantity for this module after a mutation.
  // Accepts a number (canonical), a cart array (sums qty), or an object with
  // a qty field — so every surface can pass its own shape without the badge
  // collapsing to 0 (Number([...]) is NaN). Pass { qty, fresh } for modules
  // with a fresh flag so consumers can pulse on genuinely new values.
  const announceCart = useCallback(
    (next) => {
      if (!event) return
      let n
      let f
      if (Array.isArray(next)) {
        n = next.reduce((s, it) => s + Math.max(0, Number(it?.qty || 0)), 0)
      } else if (next && typeof next === 'object') {
        n = Number(next?.qty || 0)
        f = next?.fresh
      } else {
        n = Number(next)
      }
      n = Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0))
      try {
        ownEchoRef.current = true
        window.dispatchEvent(
          new CustomEvent(event, {
            detail: { count: n, ...(typeof f === 'boolean' ? { fresh: f } : {}) },
          })
        )
        if (typeof f === 'boolean') setFresh(f)
      } catch {}
    },
    [event]
  )

  // Subscribe to the stored value for this module. The current value is
  // delivered immediately at registration (mount-time adoption — the page's
  // subscription effect is the adoption point), then on every external change
  // (other surface or tab). Never called for this instance's own announceCart
  // echoes, so surfaces never re-adopt (and re-persist) their own writes.
  const onChange = useCallback(
    (cb) => {
      subscribers.current.add(cb)
      try {
        cb(readValue(module, memberId))
      } catch {}
      return () => subscribers.current.delete(cb)
    },
    [module, memberId]
  )

  // Keep the count (and fresh flag) current when the member or module
  // changes. (Subscriber adoption happens at onChange registration, so the
  // count effect only tracks the scalar.)
  useEffect(() => {
    setCount(readCount(module, memberId))
    setFresh(readFresh(module, memberId))
  }, [module, memberId])

  // Live listeners: the module event for same-tab surfaces, storage for other
  // tabs/windows. Both refresh the count and notify subscribers with the
  // re-read stored value. Own-announce echoes are skipped — the announcing
  // surface already has the value it just wrote.
  useEffect(() => {
    const key = memberId ? storageKey(memberId) : null

    const onEvent = (e) => {
      if (e?.type !== event || !e?.detail || !Number.isFinite(Number(e.detail.count))) return
      setCount(Math.max(0, Math.trunc(Number(e.detail.count))))
      if (typeof e.detail.fresh === 'boolean') setFresh(e.detail.fresh)
      const isEcho = ownEchoRef.current
      ownEchoRef.current = false
      if (isEcho) return
      const value = readValue(module, memberId)
      subscribers.current.forEach((cb) => {
        try {
          cb(value)
        } catch {}
      })
    }
    const onStorage = (e) => {
      const k = e?.key || ''
      const freshKeyName = freshKey ? freshKey(memberId) : null
      if (key && (k === key || (freshKeyName && k === freshKeyName) || !k)) {
        setCount(readCount(module, memberId))
        setFresh(readFresh(module, memberId))
        const value = readValue(module, memberId)
        subscribers.current.forEach((cb) => {
          try {
            cb(value)
          } catch {}
        })
      }
    }

    if (event) window.addEventListener(event, onEvent)
    window.addEventListener('storage', onStorage)
    return () => {
      if (event) window.removeEventListener(event, onEvent)
      window.removeEventListener('storage', onStorage)
    }
  }, [event, storageKey, freshKey, memberId, module])

  return { count, fresh, announceCart, onChange }
}
