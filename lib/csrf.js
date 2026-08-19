// lib/csrf.js
// CSRF protection for API routes.
//
// Strategy: Validate the Origin/Referer headers on state-changing requests
// (POST, PATCH, DELETE) to prevent cross-site request forgery. Same-site
// requests will have the correct origin; cross-site requests will either
// lack the header entirely or have a different origin.
//
// This is a defense-in-depth layer — SameSite=Lax cookies already block
// most cross-site POST requests, but this catches edge cases (subdomain
// compromise, protocol downgrade, etc.).

/**
 * Check whether a request passes CSRF validation.
 *
 * @param {Request} request - The incoming Next.js request
 * @param {object} [options]
 * @param {string[]} [options.allowedOrigins] - Extra origins to allow beyond self
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateCsrf(request, options = {}) {
  // Only protect state-changing methods
  const method = request.method?.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { ok: true }
  }

  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  // Determine the allowed origin (self)
  const host = request.headers.get('host') || ''
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  const selfOrigin = `${proto}://${host}`

  const allowedOrigins = [selfOrigin, ...(options.allowedOrigins || [])]

  // Check Origin header first (most reliable)
  if (origin) {
    // Exact match against allowed origins
    if (allowedOrigins.some((ao) => origin === ao || origin === ao + '/')) {
      return { ok: true }
    }
    // Check if origin is a subdomain of an allowed origin (for www, staging, etc.)
    const originHost = new URL(origin).hostname
    if (allowedOrigins.some((ao) => {
      try {
        const allowedHost = new URL(ao).hostname
        return originHost === allowedHost || originHost.endsWith('.' + allowedHost)
      } catch {
        return false
      }
    })) {
      return { ok: true }
    }
    return { ok: false, error: 'CSRF validation failed: invalid origin' }
  }

  // Fallback to Referer header if Origin is missing (some older browsers/proxies strip it)
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`
      if (allowedOrigins.some((ao) => refererOrigin === ao || refererOrigin === ao + '/')) {
        return { ok: true }
      }
    } catch {
      // Invalid referer URL
    }
    return { ok: false, error: 'CSRF validation failed: invalid referer' }
  }

  // No Origin and no Referer — reject (legitimate browser requests always send one of these)
  // Exception: allow requests from non-browser clients (e.g., curl, Postman) when
  // an Authorization header or API key is present — these are not CSRF-vulnerable.
  const hasApiKey = request.headers.get('x-api-key')
  const hasAuthHeader = request.headers.get('authorization')
  if (hasApiKey || hasAuthHeader) {
    return { ok: true }
  }

  return { ok: false, error: 'CSRF validation failed: missing origin and referer' }
}

/**
 * Middleware-style CSRF check that returns a NextResponse if validation fails.
 * Import and call at the top of any POST/PATCH/DELETE handler.
 *
 * @param {Request} request
 * @param {object} [options]
 * @returns {Response|null} - Null if OK, Response with error if CSRF check fails
 */
export function csrfGuard(request, options = {}) {
  const result = validateCsrf(request, options)
  if (result.ok) return null

  return Response.json(
    { ok: false, error: result.error },
    {
      status: 403,
      headers: { 'X-Content-Type-Options': 'nosniff' },
    },
  )
}
