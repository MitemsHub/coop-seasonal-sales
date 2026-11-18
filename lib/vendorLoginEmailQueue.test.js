import { describe, expect, it } from 'vitest'
import { sendVendorLoginEmails } from './vendorLoginEmailQueue'
import {
  SMTP_PROVIDER_HOURLY_LIMIT,
  VENDOR_EMAIL_HOUR_LIMIT,
  VENDOR_EMAIL_INTERVAL_MS,
  VENDOR_EMAIL_MINUTE_LIMIT,
} from './vendorEmailLimits'

const vendors = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Vendor ${index + 1}`,
    email: `vendor${index + 1}@example.com`,
    passcode: `CODE${index + 1}`,
  }))

const ok = () => ({
  res: { ok: true, status: 200, headers: { get: () => null } },
  json: { ok: true },
})

function maxInFixedWindow(times, windowMs) {
  const buckets = new Map()
  for (const time of times) {
    const bucket = Math.floor(time / windowMs)
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1)
  }
  return Math.max(0, ...buckets.values())
}

function maxInRollingWindow(times, windowMs) {
  let start = 0
  let max = 0
  for (let end = 0; end < times.length; end += 1) {
    while (times[end] - times[start] > windowMs) start += 1
    max = Math.max(max, end - start + 1)
  }
  return max
}

async function runPaced(count, startAt = 0) {
  let clock = startAt
  const sendTimes = []
  const progress = []

  const result = await sendVendorLoginEmails({
    vendors: vendors(count),
    wait: async (ms) => {
      clock += ms
    },
    send: async () => {
      sendTimes.push(clock)
      return ok()
    },
    onProgress: (item) => progress.push(item),
  })

  return { result, sendTimes, progress, startAt, endAt: clock }
}

describe('paced vendor login emails', () => {
  it('keeps a 500-email run below the minute, hour, and SMTP provider limits', async () => {
    for (const startAt of [0, 1, 250, 999, 5000, 9999]) {
      const { result, sendTimes, progress, endAt } = await runPaced(500, startAt)

      expect(result.sent).toBe(500)
      expect(result.failed).toEqual([])
      expect(sendTimes).toHaveLength(500)
      expect(sendTimes[1] - sendTimes[0]).toBe(VENDOR_EMAIL_INTERVAL_MS)
      expect(endAt - sendTimes[0]).toBe(499 * VENDOR_EMAIL_INTERVAL_MS)

      const perMinute = maxInFixedWindow(sendTimes, 60_000)
      const perHour = maxInFixedWindow(sendTimes, 60 * 60_000)
      expect(perMinute).toBe(6)
      expect(perMinute).toBeLessThanOrEqual(VENDOR_EMAIL_MINUTE_LIMIT)
      expect(perHour).toBe(360)
      expect(perHour).toBeLessThan(VENDOR_EMAIL_HOUR_LIMIT)
      expect(perHour).toBeLessThan(SMTP_PROVIDER_HOURLY_LIMIT)

      // HostGator counts an hour as a rolling window; even including both
      // endpoints, 361 is still below its 500/hour domain limit.
      expect(maxInRollingWindow(sendTimes, 60 * 60_000)).toBe(361)
      expect(maxInRollingWindow(sendTimes, 60 * 60_000)).toBeLessThan(SMTP_PROVIDER_HOURLY_LIMIT)

      expect(progress).toHaveLength(500)
      expect(progress.at(-1)).toEqual({ done: 500, total: 500, sent: 500, failed: 0 })
    }
  })

  it('retries a 429 after at least the normal pacing interval', async () => {
    let clock = 0
    const waits = []
    const attempts = []

    const result = await sendVendorLoginEmails({
      vendors: vendors(2),
      wait: async (ms) => {
        waits.push(ms)
        clock += ms
      },
      send: async (vendor) => {
        attempts.push(vendor.id)
        if (vendor.id === 1 && attempts.filter((id) => id === 1).length === 1) {
          return {
            res: { ok: false, status: 429, headers: { get: () => '30' } },
            json: { error: 'Too many requests', retryAfter: 30 },
          }
        }
        return ok()
      },
    })

    expect(result.sent).toBe(2)
    expect(result.failed).toEqual([])
    expect(attempts).toEqual([1, 1, 2])
    expect(waits).toEqual([30_000, VENDOR_EMAIL_INTERVAL_MS])
  })

  it('stops retrying after two 429s and continues with the next vendor', async () => {
    const attempts = []
    const result = await sendVendorLoginEmails({
      vendors: vendors(2),
      wait: async () => {},
      send: async (vendor) => {
        attempts.push(vendor.id)
        if (vendor.id === 1) {
          return {
            res: { ok: false, status: 429, headers: { get: () => null } },
            json: { error: 'Too many requests' },
          }
        }
        return ok()
      },
    })

    expect(attempts).toEqual([1, 1, 1, 2])
    expect(result.sent).toBe(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({
      vendor: { id: 1 },
      error: 'Too many requests',
    })
  })
})
