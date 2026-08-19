// app/lib/repFoodStatsSync.js
// Cross-surface freshness signal for the rep food stats strip (today's
// pending queue + this-cycle posted/delivered figures). When an admin posts,
// delivers, cancels or restores an order — or a rep delivers one — the
// announcing page calls `announceRepFoodStats()`; any open rep food page
// subscribed via `onRepFoodStatsChanged` refetches `/api/rep/orders/stats`
// immediately. Same-tab consumers hear the CustomEvent; other tabs of the
// same origin hear the storage event (the same mechanism the cart counts
// use). Cross-device changes are covered by the pages' own polling.

const STORAGE_KEY = 'repFoodStatsUpdated'
const EVENT_NAME = 'rep-food-stats-updated'

export function announceRepFoodStats() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    // Best-effort — storage may be unavailable (private mode).
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: Date.now() }))
  }
}

// Subscribe to rep-food stats changes. Returns an unsubscribe function.
export function onRepFoodStatsChanged(cb) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e) => {
    if (e.key === STORAGE_KEY) cb()
  }
  const onCustom = () => cb()
  window.addEventListener('storage', onStorage)
  window.addEventListener(EVENT_NAME, onCustom)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(EVENT_NAME, onCustom)
  }
}
