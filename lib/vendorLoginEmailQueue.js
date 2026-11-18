// lib/vendorLoginEmailQueue.js
// Sends a bulk batch of vendor login emails without bursting the shared SMTP
// mailbox. The first message goes immediately; each later message waits at
// least the configured interval, including after a rate-limit retry.
import {
  VENDOR_EMAIL_INTERVAL_MS,
  VENDOR_EMAIL_RATE_LIMIT_RETRIES,
} from './vendorEmailLimits'

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryAfterMs(response, fallbackMs) {
  const seconds = Number(
    response?.json?.retryAfter ?? response?.res?.headers?.get?.('retry-after') ?? 0
  )
  return Math.max(fallbackMs, Number.isFinite(seconds) ? seconds * 1000 : 0)
}

/**
 * Send vendors in order with paced waits and bounded 429 retries.
 *
 * @param {object} options
 * @param {Array} options.vendors
 * @param {(vendor: any) => Promise<{ res: Response, json: any }>} options.send
 * @param {(ms: number) => Promise<void>} [options.wait]
 * @param {number} [options.intervalMs]
 * @param {number} [options.retries]
 * @param {(progress: { done: number, total: number, sent: number, failed: number }) => void} [options.onProgress]
 */
export async function sendVendorLoginEmails({
  vendors = [],
  send,
  wait = defaultWait,
  intervalMs = VENDOR_EMAIL_INTERVAL_MS,
  retries = VENDOR_EMAIL_RATE_LIMIT_RETRIES,
  onProgress,
}) {
  let sent = 0
  const failed = []

  for (let i = 0; i < vendors.length; i += 1) {
    const vendor = vendors[i]
    if (i > 0) await wait(intervalMs)

    try {
      let response = await send(vendor)
      for (let attempt = 0; response?.res?.status === 429 && attempt < retries; attempt += 1) {
        await wait(retryAfterMs(response, intervalMs))
        response = await send(vendor)
      }
      if (!response?.res?.ok || !response?.json?.ok) {
        throw new Error(response?.json?.error || 'Send failed')
      }
      sent += 1
    } catch (error) {
      failed.push({ vendor, error: error?.message || 'Send failed' })
    }

    onProgress?.({ done: i + 1, total: vendors.length, sent, failed: failed.length })
  }

  return { sent, failed }
}
