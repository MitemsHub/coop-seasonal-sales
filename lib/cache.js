// lib/cache.js
// Simple in-memory cache for development (use Redis in production)

class MemoryCache {
  constructor() {
    this.cache = new Map()
    this.timers = new Map()
  }

  set(key, value, ttlSeconds = 300) {
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key))
    }

    // Set the value
    if (this.cache.size >= MAX_ENTRIES && !this.cache.has(key)) {
      this.delete(this.cache.keys().next().value)
    }
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttlSeconds * 1000
    })

    // Set expiration timer
    const timer = setTimeout(() => {
      this.cache.delete(key)
      this.timers.delete(key)
    }, ttlSeconds * 1000)
    
    this.timers.set(key, timer)
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return null

    // Check if expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.delete(key)
      return null
    }

    return item.value
  }

  has(key) {
    const item = this.cache.get(key)
    if (!item) return false

    // Check if expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.delete(key)
      return false
    }

    return true
  }

  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key))
      this.timers.delete(key)
    }
    return this.cache.delete(key)
  }

  clear() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.cache.clear()
  }

  size() {
    return this.cache.size
  }

  // Get all cache keys
  keys() {
    return Array.from(this.cache.keys())
  }

  // Clear expired entries manually
  clearExpired() {
    const now = Date.now()
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        this.delete(key)
      }
    }
  }
}

// Hard cap so a long-running process cannot grow this map without bound.
const MAX_ENTRIES = 500

// Global cache instance
const cache = new MemoryCache()

// Helper function to get cached data with fallback
export async function getCached(key, fetchFn, ttlSeconds = 300) {
  try {
    // Check cache first
    if (cache.has(key)) {
      return cache.get(key)
    }

    // Fetch fresh data
    const data = await fetchFn()
    
    // Cache the result
    cache.set(key, data, ttlSeconds)
    return data
  } catch (error) {
    console.error(`Cache fetch error for key ${key}:`, error)
    throw error
  }
}

// Invalidate cache entries by pattern
export function invalidateCache(pattern) {
  console.log(`Invalidating cache entries matching pattern: ${pattern}`)
  let deletedCount = 0
  
  // Simple pattern matching for cache invalidation
  for (const key of cache.keys()) {
    if (key.includes(pattern) || key.match(new RegExp(pattern))) {
      cache.delete(key)
      deletedCount++
    }
  }
  
  console.log(`Invalidated ${deletedCount} cache entries`)
  return deletedCount
}

// Clear all cache entries
export function clearAllCache() {
  const size = cache.size()
  cache.clear()
  console.log(`Cleared all cache entries (${size} items)`)
  return size
}

// Get cache statistics
export function getCacheStats() {
  return {
    size: cache.size(),
    keys: cache.keys(),
    memoryUsage: process.memoryUsage()
  }
}

// Clear expired entries
export function clearExpiredCache() {
  const sizeBefore = cache.size()
  cache.clearExpired()
  const sizeAfter = cache.size()
  const cleared = sizeBefore - sizeAfter
  
  if (cleared > 0) {
    console.log(`Cleared ${cleared} expired cache entries`)
  }
  
  return cleared
}

// Export cache instance for direct access if needed
export { cache }

// Auto-cleanup expired entries every 5 minutes
setInterval(() => {
  clearExpiredCache()
}, 5 * 60 * 1000).unref?.()