// lib/rateLimitShared.js
// Rate limiting that survives more than one instance.
//
// The in-memory limiter in lib/rateLimit.js is per-process: on Vercel with N
// instances the effective limit is N x the configured value, and every cold
// start resets the counters. This module uses the Upstash Redis REST API when
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set, and falls back to
// the in-memory limiter otherwise so local dev keeps working unchanged.
import { checkRateLimit, rateLimitResponse } from './rateLimit'

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

export const sharedLimiterEnabled = Boolean(url && token)

async function redis(command) {
  const res = await fetch(`${url}/${command.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`rate limit store responded ${res.status}`)
  const json = await res.json()
  return json.result
}

/**
 * Same contract as checkRateLimit, but shared across instances when a Redis
 * REST endpoint is configured.
 */
export async function checkRateLimitShared(route, key, limit, windowMs) {
  if (!sharedLimiterEnabled) return checkRateLimit(route, key, limit, windowMs)

  // Fixed window bucket: one counter per route+key+window.
  const bucketIndex = Math.floor(Date.now() / windowMs)
  const bucket = `rl:${route}:${key}:${bucketIndex}`
  try {
    const count = Number(await redis(['INCR', bucket]))
    if (count === 1) await redis(['PEXPIRE', bucket, String(windowMs)])
    if (count > limit) {
      const resetAt = (bucketIndex + 1) * windowMs
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1000, resetAt - Date.now()) }
    }
    return { allowed: true, remaining: Math.max(0, limit - count), retryAfterMs: 0 }
  } catch {
    // Never lock users out because the limiter itself is unavailable.
    return { allowed: true, remaining: limit, retryAfterMs: 0 }
  }
}

export { rateLimitResponse }
