// lib/rateLimit.js
// In-memory rate limiter for API routes.
// Each key (e.g. "send-otp:john@example.com") tracks request timestamps
// and rejects new requests when the limit is reached.
//
// NOTE: In a serverless / multi-instance deployment this store resets on
// cold starts and is not shared across instances.  For production-grade
// rate limiting you would swap this for Redis or an external service.

const store = new Map()

// Periodic cleanup — remove expired keys every 60 s so memory stays bounded.
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, 60_000).unref?.()

/**
 * Check rate limit and record a request if allowed.
 *
 * @param {string} route   - Route identifier, e.g. "send-otp"
 * @param {string} key     - Discriminator within the route, e.g. an email or IP
 * @param {number} limit   - Max requests allowed in the window
 * @param {number} windowMs - Window duration in milliseconds
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function checkRateLimit(route, key, limit, windowMs) {
  const compoundKey = `${route}:${key}`
  const now = Date.now()

  let entry = store.get(compoundKey)
  if (!entry || now > entry.resetAt) {
    entry = { timestamps: [], resetAt: now + windowMs }
    store.set(compoundKey, entry)
  }

  // Prune timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0]
    const retryAfterMs = windowMs - (now - oldest)
    return { allowed: false, remaining: 0, retryAfterMs }
  }

  entry.timestamps.push(now)
  return { allowed: true, remaining: limit - entry.timestamps.length, retryAfterMs: 0 }
}

/**
 * Build a NextResponse for a rate-limited request.
 * Includes Retry-After header so clients can back off.
 */
export function rateLimitResponse(retryAfterMs) {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000)
  return Response.json(
    {
      error: 'Too many requests. Please try again later.',
      retryAfter: retryAfterSec,
    },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSec) },
    },
  )
}
