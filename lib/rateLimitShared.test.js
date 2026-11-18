import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VENDOR_EMAIL_HOUR_LIMIT,
  VENDOR_EMAIL_MINUTE_LIMIT,
} from './vendorEmailLimits'

const originalUrl = process.env.UPSTASH_REDIS_REST_URL
const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN

async function loadLimiter({ redis = false } = {}) {
  vi.resetModules()
  if (redis) {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
  } else {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  }
  return import('./rateLimitShared')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
  if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
  else process.env.UPSTASH_REDIS_REST_URL = originalUrl
  if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken
})

describe('shared rate limiter fallback', () => {
  it('enforces the 8-per-minute vendor email limit without Redis', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { checkRateLimitShared, sharedLimiterEnabled } = await loadLimiter()
    expect(sharedLimiterEnabled).toBe(false)

    const route = 'test-vendor-email-minute'
    for (let i = 0; i < VENDOR_EMAIL_MINUTE_LIMIT; i += 1) {
      await expect(checkRateLimitShared(route, 'smtp', VENDOR_EMAIL_MINUTE_LIMIT, 60_000)).resolves.toMatchObject({
        allowed: true,
      })
    }

    const blocked = await checkRateLimitShared(route, 'smtp', VENDOR_EMAIL_MINUTE_LIMIT, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)

    vi.advanceTimersByTime(60_001)
    await expect(checkRateLimitShared(route, 'smtp', VENDOR_EMAIL_MINUTE_LIMIT, 60_000)).resolves.toMatchObject({
      allowed: true,
    })
  })

  it('enforces the 450-per-hour vendor email limit without Redis', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { checkRateLimitShared } = await loadLimiter()

    const route = 'test-vendor-email-hour'
    for (let i = 0; i < VENDOR_EMAIL_HOUR_LIMIT; i += 1) {
      const result = await checkRateLimitShared(route, 'smtp', VENDOR_EMAIL_HOUR_LIMIT, 60 * 60_000)
      expect(result.allowed).toBe(true)
    }

    const blocked = await checkRateLimitShared(route, 'smtp', VENDOR_EMAIL_HOUR_LIMIT, 60 * 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('uses the local limiter when Redis is configured but unreachable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Redis offline')))
    const { checkRateLimitShared, sharedLimiterEnabled } = await loadLimiter({ redis: true })
    expect(sharedLimiterEnabled).toBe(true)

    const route = 'test-vendor-email-redis-down'
    for (let i = 0; i < VENDOR_EMAIL_MINUTE_LIMIT; i += 1) {
      await expect(checkRateLimitShared(route, 'smtp', VENDOR_EMAIL_MINUTE_LIMIT, 60_000)).resolves.toMatchObject({
        allowed: true,
      })
    }

    await expect(checkRateLimitShared(route, 'smtp', VENDOR_EMAIL_MINUTE_LIMIT, 60_000)).resolves.toMatchObject({
      allowed: false,
    })
    expect(fetch).toHaveBeenCalledTimes(VENDOR_EMAIL_MINUTE_LIMIT + 1)
  })
})
