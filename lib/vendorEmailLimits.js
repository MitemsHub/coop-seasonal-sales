// lib/vendorEmailLimits.js
// Shared limits for exhibition vendor login email.
//
// The app sends through the coop's HostGator shared-hosting mailbox. HostGator
// allows 500 outgoing messages per hour per domain, so the app caps itself at
// 450/hour, leaving headroom for contact-form and other site mail.
export const SMTP_PROVIDER_HOURLY_LIMIT = 500
export const VENDOR_EMAIL_HOUR_LIMIT = 450
export const VENDOR_EMAIL_MINUTE_LIMIT = 8

// The import modal sends the first email immediately, then waits this long
// before each subsequent one: 6/minute and at most 360 in any fixed hour.
export const VENDOR_EMAIL_INTERVAL_MS = 10_000
export const VENDOR_EMAIL_RATE_LIMIT_RETRIES = 2
