// app/lib/urlState.js
// The URL is where an admin list keeps its place: which page, how many rows and
// which filters. Reading it on mount means a reload, a Back into the screen or
// a link pasted to a colleague all land on the same view; writing it back on
// every change keeps that true as the desk works.
//
// Writes go through history.replaceState rather than the Next router on
// purpose: a filter tweak is not a navigation, and pushing an entry per page
// would turn Back into "undo my last 17 page clicks". Replacing the current
// entry leaves Back going where the person actually came from, with the list's
// URL intact when they return to it.

export function readUrlParam(name, fallback = '') {
  if (typeof window === 'undefined') return fallback
  const value = new URLSearchParams(window.location.search).get(name)
  return value == null ? fallback : value
}

export function readUrlInt(name, fallback) {
  const raw = readUrlParam(name, '')
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback
}

// Only the keys passed are touched; anything else already in the query string
// (another screen's params, a campaign tag) is left alone. An empty value drops
// the key, so defaults stay out of the bar and links stay short.
export function writeUrlState(values) {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  let changed = false
  for (const [name, raw] of Object.entries(values)) {
    const value = raw == null ? '' : String(raw)
    if (!value) {
      if (params.has(name)) {
        params.delete(name)
        changed = true
      }
    } else if (params.get(name) !== value) {
      params.set(name, value)
      changed = true
    }
  }
  if (!changed) return
  const qs = params.toString()
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
  // Keep history.state: the App Router stores its own routing state there.
  window.history.replaceState(window.history.state, '', url)
}
