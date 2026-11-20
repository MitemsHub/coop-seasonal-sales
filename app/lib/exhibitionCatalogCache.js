// app/lib/exhibitionCatalogCache.js
// Process-local cache for the member catalogue core (cycle, stands, categories,
// products). It is identical for every member, so rebuilding it on each request
// is wasted work on a busy exhibition day.
//
// Approving, rejecting, publishing or repricing a product must show up in the
// shop immediately, so every product mutation invalidates this cache.

const TTL_MS = 60_000
const cache = new Map() // cycleId -> { at, data }

export function readCatalogCore(cycleId) {
  const hit = cache.get(cycleId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data
  return null
}

export function writeCatalogCore(cycleId, data) {
  cache.set(cycleId, { at: Date.now(), data })
  if (cache.size > 50) cache.delete(cache.keys().next().value)
}

export function invalidateCatalogCore() {
  cache.clear()
}
