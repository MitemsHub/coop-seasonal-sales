// app/lib/exhibitionPendingBadge.js
// Member-side freshness tracking for the Navbar's exhibition "awaiting
// approval" badge — mirrors the admin switcher treatment: the badge pulses
// only when a genuinely NEW pending order appears since the member last
// viewed their pending queue, even if the net pending count is unchanged.
// Tracking the full ID set (not just the count) makes swaps detectable:
// one order approved while a different one arrives keeps the count the same
// but changes the ID set.

export const PENDING_COUNT_KEY = (mid) => `exhibitionPending_${mid}`
export const PENDING_IDS_KEY = (mid) => `exhibitionPendingIds_${mid}`
export const PENDING_SEEN_KEY = (mid) => `exhibitionPendingSeen_${mid}`
export const PENDING_FRESH_KEY = (mid) => `exhibitionPendingFresh_${mid}`

// The set of pending order IDs the member has already seen (viewed).
export function readPendingSeen(mid) {
  try {
    const raw = localStorage.getItem(PENDING_SEEN_KEY(mid))
    const arr = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set()
  } catch {
    return new Set()
  }
}

export function writePendingIds(mid, ids) {
  try {
    localStorage.setItem(PENDING_IDS_KEY(mid), JSON.stringify([...new Set(ids.map(String))]))
  } catch {
    // Best-effort.
  }
}

// True when any current pending ID was not in the member's last-seen set.
export function hasNewPending(mid, ids) {
  const seen = readPendingSeen(mid)
  return ids.some((id) => !seen.has(String(id)))
}

// Record the current queue as seen (the member is looking at it) and clear
// the fresh flag so the badge stops pulsing.
export function markPendingSeen(mid, ids) {
  try {
    localStorage.setItem(PENDING_SEEN_KEY(mid), JSON.stringify([...new Set(ids.map(String))]))
    localStorage.setItem(PENDING_FRESH_KEY(mid), '0')
  } catch {
    // Best-effort.
  }
}

export function writePendingFresh(mid, fresh) {
  try {
    localStorage.setItem(PENDING_FRESH_KEY(mid), fresh ? '1' : '0')
  } catch {
    // Best-effort.
  }
}

export function readPendingFresh(mid) {
  try {
    return localStorage.getItem(PENDING_FRESH_KEY(mid)) === '1'
  } catch {
    return false
  }
}
