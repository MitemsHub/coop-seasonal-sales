// app/hooks/useCartCount.test.js
// Unit tests for the shared cart-count hook — the Navbar badge + shop surfaces
// all depend on its sync mechanisms:
//   1. announceCart → the module event updates every same-tab consumer the
//      same tick.
//   2. storage-event re-sync → a change from another tab/window re-reads the
//      stored cart and propagates to subscribers.
//   3. mount adoption + echo suppression → subscribers receive the stored
//      value at registration (and on every external change), but never for
//      this instance's own announceCart echoes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { renderHook, act } from '@testing-library/react'
import useCartCount from './useCartCount'

const FOOD_KEY = 'cart_M1'
const RAM_KEY = 'ramCart_M1'

beforeEach(() => {
  localStorage.clear()
})

describe('useCartCount', () => {
  it('reads the stored count on mount', () => {
    localStorage.setItem(FOOD_KEY, JSON.stringify([{ qty: 2 }, { qty: 3 }]))
    const { result } = renderHook(() => useCartCount('food', { memberId: 'M1' }))
    expect(result.current.count).toBe(5)
  })

  it('propagates announceCart to every consumer of the same module, instantly', () => {
    const a = renderHook(() => useCartCount('food', { memberId: 'M1' }))
    const b = renderHook(() => useCartCount('food', { memberId: 'M1' }))
    expect(a.result.current.count).toBe(0)

    act(() => {
      a.result.current.announceCart(4)
    })

    expect(a.result.current.count).toBe(4)
    expect(b.result.current.count).toBe(4)
  })

  it('ignores announceCart values that are not finite numbers', () => {
    const { result } = renderHook(() => useCartCount('food', { memberId: 'M1' }))
    act(() => {
      result.current.announceCart('not-a-number')
    })
    expect(result.current.count).toBe(0)
  })

  it('sums array carts passed to announceCart (the /cart page shape)', () => {
    const a = renderHook(() => useCartCount('food', { memberId: 'M1' }))
    const b = renderHook(() => useCartCount('food', { memberId: 'M1' }))

    act(() => {
      a.result.current.announceCart([
        { sku: 'A', qty: 2 },
        { sku: 'B', qty: 3 },
        { sku: 'C', qty: 0 },
      ])
    })

    // Number([...]) would be NaN → 0; the hook must sum the lines instead.
    expect(a.result.current.count).toBe(5)
    expect(b.result.current.count).toBe(5)

    act(() => {
      a.result.current.announceCart([])
    })
    expect(a.result.current.count).toBe(0)
  })

  it('re-reads the count on a storage event for its own key (cross-tab sync)', () => {
    localStorage.setItem(FOOD_KEY, JSON.stringify([{ qty: 1 }]))
    const { result } = renderHook(() => useCartCount('food', { memberId: 'M1' }))
    expect(result.current.count).toBe(1)

    // Another tab writes a bigger cart and fires the storage event.
    localStorage.setItem(FOOD_KEY, JSON.stringify([{ qty: 2 }, { qty: 3 }, { qty: 4 }]))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: FOOD_KEY }))
    })

    expect(result.current.count).toBe(9)
  })

  it('ignores storage events for other members/keys', () => {
    const { result } = renderHook(() => useCartCount('food', { memberId: 'M1' }))
    localStorage.setItem('cart_M2', JSON.stringify([{ qty: 9 }]))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'cart_M2' }))
    })
    expect(result.current.count).toBe(0)
  })

  it('reads scalar-number keys for the orders module', () => {
    localStorage.setItem('ordersCount_M1', '7')
    const { result } = renderHook(() => useCartCount('orders', { memberId: 'M1' }))
    expect(result.current.count).toBe(7)
  })

  describe('mount adoption + echo suppression', () => {
    it('delivers the stored value to a subscriber at registration (mount-time adoption)', () => {
      localStorage.setItem(FOOD_KEY, JSON.stringify([{ sku: 'A', qty: 2 }]))
      const cb = vi.fn()
      renderHook(() => {
        const { onChange } = useCartCount('food', { memberId: 'M1' })
        useEffect(() => onChange(cb), [onChange])
        return null
      })
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith([{ sku: 'A', qty: 2 }])
    })

    it('delivers null when nothing is stored yet', () => {
      const cb = vi.fn()
      renderHook(() => {
        const { onChange } = useCartCount('food', { memberId: 'M1' })
        useEffect(() => onChange(cb), [onChange])
        return null
      })
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith(null)
    })

    it('does not re-deliver to the same instance on its own announceCart (echo skip)', () => {
      const cb = vi.fn()
      const announceRef = { current: null }
      renderHook(() => {
        const { onChange, announceCart } = useCartCount('food', { memberId: 'M1' })
        announceRef.current = announceCart
        useEffect(() => onChange(cb), [onChange])
        return null
      })
      expect(cb).toHaveBeenCalledTimes(1) // registration adoption
      act(() => {
        announceRef.current(3)
      })
      // The announcing instance must not be re-notified with its own write.
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('still delivers the new stored value to a different instance when one announces', () => {
      localStorage.setItem(FOOD_KEY, JSON.stringify([{ sku: 'A', qty: 1 }]))
      const cbA = vi.fn()
      const cbB = vi.fn()
      const announceA = { current: null }
      renderHook(() => {
        const { onChange, announceCart } = useCartCount('food', { memberId: 'M1' })
        announceA.current = announceCart
        useEffect(() => onChange(cbA), [onChange])
        return null
      })
      renderHook(() => {
        const { onChange } = useCartCount('food', { memberId: 'M1' })
        useEffect(() => onChange(cbB), [onChange])
        return null
      })
      expect(cbA).toHaveBeenCalledTimes(1)
      expect(cbB).toHaveBeenCalledTimes(1)

      // Instance A writes a new cart and announces — B must adopt the change.
      const next = [{ sku: 'B', qty: 4 }]
      localStorage.setItem(FOOD_KEY, JSON.stringify(next))
      act(() => {
        announceA.current(4)
      })
      expect(cbA).toHaveBeenCalledTimes(1) // echo skipped for A
      expect(cbB).toHaveBeenCalledTimes(2) // adopted the change
      expect(cbB).toHaveBeenLastCalledWith(next)
    })

    it('delivers the re-read value to subscribers on a cross-tab storage event', () => {
      localStorage.setItem(FOOD_KEY, JSON.stringify([{ sku: 'A', qty: 1 }]))
      const cb = vi.fn()
      renderHook(() => {
        const { onChange } = useCartCount('food', { memberId: 'M1' })
        useEffect(() => onChange(cb), [onChange])
        return null
      })
      expect(cb).toHaveBeenCalledTimes(1)

      const next = [{ sku: 'A', qty: 3 }]
      localStorage.setItem(FOOD_KEY, JSON.stringify(next))
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: FOOD_KEY }))
      })
      expect(cb).toHaveBeenCalledTimes(2)
      expect(cb).toHaveBeenLastCalledWith(next)
    })
  })

  describe('ram event sync', () => {
    it('announceCart still updates ram consumers instantly (event path)', () => {
      const a = renderHook(() => useCartCount('ram', { memberId: 'M1' }))
      const b = renderHook(() => useCartCount('ram', { memberId: 'M1' }))
      act(() => {
        a.result.current.announceCart(2)
      })
      expect(a.result.current.count).toBe(2)
      expect(b.result.current.count).toBe(2)
    })
  })

  describe('exhibitionPending fresh flag', () => {
    it('reads the stored fresh flag on mount', () => {
      localStorage.setItem('exhibitionPending_M1', '3')
      localStorage.setItem('exhibitionPendingFresh_M1', '1')
      const { result } = renderHook(() => useCartCount('exhibitionPending', { memberId: 'M1' }))
      expect(result.current.count).toBe(3)
      expect(result.current.fresh).toBe(true)
    })

    it('announceCart({ qty, fresh }) propagates fresh to every consumer', () => {
      const a = renderHook(() => useCartCount('exhibitionPending', { memberId: 'M1' }))
      const b = renderHook(() => useCartCount('exhibitionPending', { memberId: 'M1' }))
      expect(a.result.current.fresh).toBe(false)

      act(() => {
        a.result.current.announceCart({ qty: 2, fresh: true })
      })

      expect(a.result.current.count).toBe(2)
      expect(a.result.current.fresh).toBe(true)
      expect(b.result.current.fresh).toBe(true)
    })

    it('fresh=false marks the queue as seen (stops pulsing)', () => {
      const { result } = renderHook(() => useCartCount('exhibitionPending', { memberId: 'M1' }))
      localStorage.setItem('exhibitionPending_M1', '1')
      act(() => {
        result.current.announceCart({ qty: 1, fresh: false })
      })
      expect(result.current.count).toBe(1)
      expect(result.current.fresh).toBe(false)
    })

    it('re-reads the fresh flag on a storage event for its fresh key', () => {
      localStorage.setItem('exhibitionPending_M1', '1')
      localStorage.setItem('exhibitionPendingFresh_M1', '1')
      const { result } = renderHook(() => useCartCount('exhibitionPending', { memberId: 'M1' }))
      expect(result.current.fresh).toBe(true)

      localStorage.setItem('exhibitionPendingFresh_M1', '0')
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'exhibitionPendingFresh_M1' }))
      })
      expect(result.current.fresh).toBe(false)
    })
  })
})
