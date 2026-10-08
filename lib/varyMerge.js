// lib/varyMerge.js
//
// Next.js 15.5 replays build-time response headers for App Router pages with a
// plain `res.setHeader('vary', <rsc list>)` (emitted into the compiled page
// bundle, .next/server/app/*.js), which REPLACES any Vary value already on the
// response — dropping the `Vary: Accept` our middleware sets for Markdown
// content negotiation. Next's own appendHeader() merges correctly, so only this
// replay loses values (verified by header-write tracing, see git history).
//
// installVaryMerge() gives the `Vary` header union semantics on the Node
// ServerResponse: every setHeader('vary', v) unions its comma-separated tokens
// with what is already present (case-insensitively deduped, order preserved)
// instead of replacing it. Vary is a list header, so a union is always
// semantically correct — it only ever tells caches about additional
// dimensions the response varies on.

import { ServerResponse } from 'node:http'

const VARY = 'vary'

let installed = false

/** Split one or more comma-separated header values into deduped-safe tokens. */
function toTokens(value) {
  const tokens = []
  for (const single of [].concat(value ?? [])) {
    if (single == null) continue
    for (const part of String(single).split(',')) {
      const token = part.trim()
      if (token) tokens.push(token)
    }
  }
  return tokens
}

/** Union two (or array-valued) Vary values into one comma-separated string. */
export function unionVary(existing, incoming) {
  const seen = new Set()
  const merged = []
  for (const token of [...toTokens(existing), ...toTokens(incoming)]) {
    const key = token.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(token)
    }
  }
  return merged.join(', ')
}

/**
 * Patch http.ServerResponse so `setHeader('vary', …)` merges with existing
 * values instead of replacing them. Idempotent; returns true when installed.
 * Called from instrumentation.js register() at server start.
 */
export function installVaryMerge(Response = ServerResponse) {
  if (installed) return false
  installed = true
  const originalSetHeader = Response.prototype.setHeader
  Response.prototype.setHeader = function setHeader(name, value) {
    if (String(name).toLowerCase() === VARY) {
      const existing = this.getHeader(VARY)
      if (existing !== undefined && existing !== null) {
        return originalSetHeader.call(this, name, unionVary(existing, value))
      }
    }
    return originalSetHeader.call(this, name, value)
  }
  return true
}
