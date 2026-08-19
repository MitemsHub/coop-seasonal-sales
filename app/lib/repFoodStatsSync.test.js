// app/lib/repFoodStatsSync.test.js
// Unit tests for the rep-food stats freshness signal: an admin page calling
// `announceRepFoodStats` must reach an open rep food page immediately —
// same-tab consumers via the CustomEvent, other tabs of the same origin via
// the storage event — and unsubscribing must stop delivery.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { announceRepFoodStats, onRepFoodStatsChanged } from './repFoodStatsSync'

const KEY = 'repFoodStatsUpdated'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  // Any listener that failed to unsubscribe leaks across tests.
  window.dispatchEvent(new CustomEvent('rep-food-stats-updated'))
})

describe('repFoodStatsSync', () => {
  it('announce fires the same-tab listener exactly once', () => {
    const cb = vi.fn()
    const off = onRepFoodStatsChanged(cb)
    announceRepFoodStats()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })

  it('reaches listeners in other tabs via the storage event', () => {
    const cb = vi.fn()
    const off = onRepFoodStatsChanged(cb)
    announceRepFoodStats()
    // Another tab hears the write as a storage event.
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect(cb).toHaveBeenCalledTimes(2) // custom event + storage event
    off()
  })

  it('ignores storage events for other keys', () => {
    const cb = vi.fn()
    const off = onRepFoodStatsChanged(cb)
    window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key' }))
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it('unsubscribing stops delivery', () => {
    const cb = vi.fn()
    const off = onRepFoodStatsChanged(cb)
    off()
    announceRepFoodStats()
    expect(cb).not.toHaveBeenCalled()
  })
})
