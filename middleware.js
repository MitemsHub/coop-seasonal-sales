// middleware.js
// Comprehensive security middleware for the Coop Seasonal Sales System
import { NextResponse } from 'next/server'
import { verify } from './lib/signingEdge.js'
import {
  wantsMarkdown,
  isAssetPath,
  HOMEPAGE_MARKDOWN,
  notFoundMarkdown,
  markdownResponse,
} from './lib/agentContent.js'

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map()

// Security headers configuration
const isProd = process.env.NODE_ENV === 'production'
// Allow the browser-side Supabase client to reach a local PostgREST gateway
// during local testing (e.g. http://127.0.0.1:54321). Production keeps the
// strict connect-src of 'self' + supabase.co.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const isLocalSupabase = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(supabaseUrl)
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // wss:// is required because ChatWidget subscribes to Supabase Realtime over
  // WebSockets; without it the live chat silently falls back to polling under
  // this CSP (now applied to every page, including the landing page).
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co${isLocalSupabase ? ` ${supabaseUrl} ${supabaseUrl.replace(/^http/, 'ws')}` : ''};`
}

// Paths the original, narrower middleware matcher covered. Rate limiting stays
// pinned to exactly that surface so widening the matcher (needed for Markdown
// negotiation + Markdown 404s) does not change existing abuse protection.
const LEGACY_RATE_LIMIT_RE = /^\/(api|admin|rep|vendor|shop|exhibition)(\/|$)|^\/uploads$/
function isLegacyRateLimitedPath(pathname) {
  return LEGACY_RATE_LIMIT_RE.test(pathname)
}

// Forward just enough context to the internal existence probe so protected
// routes answer with their real status (redirect/401) instead of a false 404.
function probeHeaders(request) {
  const headers = new Headers()
  headers.set('accept', 'text/markdown')
  headers.set('x-md-probe', '1')
  for (const name of ['cookie', 'user-agent', 'x-forwarded-for', 'x-real-ip']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

// Rate limiting function
function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now()
  const windowStart = now - windowMs
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, [])
  }
  
  const requests = rateLimitStore.get(key)
  
  // Remove old requests outside the window
  const validRequests = requests.filter(timestamp => timestamp > windowStart)
  
  if (validRequests.length >= maxRequests) {
    return false
  }
  
  validRequests.push(now)
  rateLimitStore.set(key, validRequests)
  
  return true
}

// Get client IP address
function getClientIP(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const remoteAddr = request.headers.get('x-vercel-forwarded-for')
  
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  
  return realIP || remoteAddr || 'unknown'
}

// Validate session token
async function validateSession(request, sessionType) {
  try {
    const cookieName = `${sessionType}_token`
    const sessionCookie = request.cookies.get(cookieName)
    const sessionToken = sessionCookie?.value
    
    if (!sessionToken) {
      return { isValid: false, reason: 'No session token' }
    }
    
    const claim = await verify(sessionToken)
    
    if (!claim || claim.role !== sessionType) {
      return { isValid: false, reason: 'Invalid token or role' }
    }
    
    return { isValid: true, sessionToken, claim }
  } catch (error) {
    console.error('Session validation error:', error)
    return { isValid: false, reason: 'Validation error' }
  }
}

// Main middleware function
export async function middleware(request) {
  const { pathname } = request.nextUrl

  // Legacy route — the public food survey moved to /survey (every other survey
  // surface carries the name). Hard 307 so links reps already received keep
  // working without JS. Exact match only: static photo files under
  // /uploads/… are served from /public and never reach this branch.
  if (pathname === '/uploads') {
    return NextResponse.redirect(new URL('/survey', request.url), 307)
  }

  // Static assets (build files and /public files) were never matched by the
  // old, narrower matcher — pass them through untouched: no negotiation, no
  // headers, no rate limiting.
  if (isAssetPath(pathname)) {
    return NextResponse.next()
  }

  const method = (request.method || 'GET').toUpperCase()
  const isProbe = request.headers.get('x-md-probe') === '1'

  // ---- Agent content negotiation (GET/HEAD documents only) -------------
  // An explicit `Accept: text/markdown` receives Markdown instead of HTML:
  //   - '/' returns the homepage summary;
  //   - every other path first asks the app itself whether it exists (the
  //     x-md-probe marker prevents recursion; redirect: 'manual' keeps
  //     auth redirects visible) — a real 404 becomes a Markdown 404 with a
  //     link to llms.txt/sitemap, anything else falls through to HTML.
  if (!isProbe && (method === 'GET' || method === 'HEAD') && wantsMarkdown(request.headers.get('accept'))) {
    if (pathname === '/') {
      return markdownResponse(method === 'HEAD' ? null : HOMEPAGE_MARKDOWN, 200)
    }
    try {
      const probe = await fetch(new URL(pathname, request.url).toString(), {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: probeHeaders(request),
      })
      if (probe.status === 404) {
        return markdownResponse(method === 'HEAD' ? null : notFoundMarkdown(pathname), 404)
      }
    } catch {
      // Existence probe failed — fall through to normal HTML handling.
    }
  }

  const clientIP = getClientIP(request)
  
  // Create response with security headers
  const response = NextResponse.next()
  
  // Add security headers to all responses
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  if (isProd) response.headers.set('X-Frame-Options', 'DENY')

  // Document responses depend on Accept (Markdown vs HTML negotiation), so
  // advertise it. Next appends its own RSC vary values to this header.
  response.headers.set('Vary', 'Accept')
  
  // Rate limiting is a production anti-abuse measure. The in-memory store is a
  // dev stand-in (real deployments use Redis), so local development + smoke
  // tests run without throttling — otherwise a long test run trips the window.
  // Scoped to the originally matched routes (isLegacyRateLimitedPath) so the
  // widened matcher does not newly throttle landing-page traffic; internal
  // probes (isProbe) are already counted via their originating request.
  if (isProd && !isProbe && isLegacyRateLimitedPath(pathname)) {
    const globalRateLimit = checkRateLimit(`global:${clientIP}`, 100, 60000) // 100 requests per minute
    if (!globalRateLimit) {
      console.warn(`Global rate limit exceeded for IP: ${clientIP}`);
      return new NextResponse('Too Many Requests', { 
        status: 429,
        headers: {
          'Retry-After': '60',
            ...securityHeaders,
            ...(isProd ? { 'X-Frame-Options': 'DENY' } : {})
        }
      })
    }
  }
  
  // API route protection
  if (pathname.startsWith('/api/')) {
    // More strict rate limiting for API routes
    if (isProd) {
      const apiRateLimit = checkRateLimit(`api:${clientIP}`, 50, 60000) // 50 API requests per minute
      if (!apiRateLimit) {
        console.warn(`API rate limit exceeded for IP: ${clientIP}`);
        return new NextResponse('Too Many API Requests', { 
          status: 429,
          headers: {
            'Retry-After': '60',
            ...securityHeaders,
            ...(isProd ? { 'X-Frame-Options': 'DENY' } : {})
          }
        })
      }
    }
    
    // CSRF protection for state-changing API requests
    // Skip for GET/HEAD/OPTIONS (safe methods) and auth-related routes
    // (which are the initial entry points and need to work cross-origin)
    const method = request.method?.toUpperCase()
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      // Skip CSRF for auth entry points (login, OTP, forgot-password, contact form)
      // These are designed to be called from untrusted contexts but are protected
      // by their own rate limiting and input validation.
      const isAuthRoute = pathname.includes('/auth/check') || 
                          pathname.includes('/auth/send-otp') || 
                          pathname.includes('/auth/verify-otp') ||
                          pathname.includes('/auth/login') ||
                          pathname.includes('/auth/set-password') ||
                          pathname.includes('/auth/forgot-password') ||
                          pathname.includes('/auth/reset-password') ||
                          pathname.includes('/pin/session') ||
                          pathname.includes('/rep/session') ||
                          pathname.includes('/rep/access') ||
                          pathname.includes('/vendor/session') ||
                          pathname === '/api/contact'
      
      if (!isAuthRoute) {
        const origin = request.headers.get('origin')
        const referer = request.headers.get('referer')
        const host = request.headers.get('host') || ''
        const proto = request.headers.get('x-forwarded-proto') || 'http'
        const selfOrigin = `${proto}://${host}`
        
        // Build allowed origins list
        const allowedOrigins = [selfOrigin]
        // Allow Supabase URL for local dev
        if (supabaseUrl && isLocalSupabase) allowedOrigins.push(supabaseUrl)
        
        let csrfPassed = false
        
        if (origin) {
          csrfPassed = allowedOrigins.some((ao) => 
            origin === ao || origin === ao + '/' ||
            (() => {
              try {
                const originHost = new URL(origin).hostname
                return allowedOrigins.some((a) => {
                  try { return originHost === new URL(a).hostname } catch { return false }
                })
              } catch { return false }
            })()
          )
        } else if (referer) {
          try {
            const refererUrl = new URL(referer)
            const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`
            csrfPassed = allowedOrigins.some((ao) => refererOrigin === ao || refererOrigin === ao + '/')
          } catch {}
        }
        
        // Allow requests with no origin/referer only if they have an auth header
        // (API clients like curl/Postman don't send Origin)
        if (!csrfPassed && !origin && !referer) {
          const hasAuth = request.headers.get('authorization') || request.headers.get('x-api-key')
          if (hasAuth) csrfPassed = true
        }
        
        if (!csrfPassed) {
          console.warn(`CSRF rejected: ${method} ${pathname} from origin=${origin} referer=${referer}`)
          return new NextResponse('CSRF validation failed', {
            status: 403,
            headers: { ...securityHeaders, 'X-Content-Type-Options': 'nosniff' },
          })
        }
      }
    }

    // Admin API protection
    if (pathname.startsWith('/api/admin/')) {
      // Reasonable rate limiting for admin APIs
      if (isProd) {
        const adminRateLimit = checkRateLimit(`admin:${clientIP}`, 60, 60000) // 60 admin requests per minute
        if (!adminRateLimit) {
          console.warn(`Admin API rate limit exceeded for IP: ${clientIP}`);
          return new NextResponse('Too Many Admin Requests', { 
            status: 429,
            headers: {
              'Retry-After': '60',
              ...securityHeaders,
              ...(isProd ? { 'X-Frame-Options': 'DENY' } : {})
            }
          })
        }
      }
      
      // Skip session validation for login endpoints
      if (!pathname.includes('/session')) {
        const sessionValidation = await validateSession(request, 'admin')
        if (!sessionValidation.isValid) {
          console.warn(`Unauthorized admin API access from IP: ${clientIP}`);
          return new NextResponse('Unauthorized', { 
            status: 401,
            headers: { ...securityHeaders, ...(isProd ? { 'X-Frame-Options': 'DENY' } : {}) }
          })
        }
      }
    }
    
    // Vendor API protection
    if (pathname.startsWith('/api/vendor/')) {
      if (isProd) {
        const vendorRateLimit = checkRateLimit(`vendor:${clientIP}`, 40, 60000) // 40 vendor requests per minute
        if (!vendorRateLimit) {
          console.warn(`Vendor API rate limit exceeded for IP: ${clientIP}`);
          return new NextResponse('Too Many Vendor Requests', {
            status: 429,
            headers: {
              'Retry-After': '60',
              ...securityHeaders,
              ...(isProd ? { 'X-Frame-Options': 'DENY' } : {})
            }
          })
        }
      }

      // Skip session validation for login endpoints
      if (!pathname.includes('/session')) {
        const sessionValidation = await validateSession(request, 'vendor')
        if (!sessionValidation.isValid) {
          console.warn(`Unauthorized vendor API access from IP: ${clientIP}`);
          return new NextResponse('Unauthorized', {
            status: 401,
            headers: { ...securityHeaders, ...(isProd ? { 'X-Frame-Options': 'DENY' } : {}) }
          })
        }
      }
    }

    // Rep API protection
    if (pathname.startsWith('/api/rep/')) {
      if (isProd) {
        const repRateLimit = checkRateLimit(`rep:${clientIP}`, 30, 60000) // 30 rep requests per minute
        if (!repRateLimit) {
          console.warn(`Rep API rate limit exceeded for IP: ${clientIP}`);
          return new NextResponse('Too Many Rep Requests', { 
            status: 429,
            headers: {
              'Retry-After': '60',
              ...securityHeaders,
              ...(isProd ? { 'X-Frame-Options': 'DENY' } : {})
            }
          })
        }
      }
      
      // Skip session validation for login endpoints
      if (!pathname.includes('/session')) {
        const sessionValidation = await validateSession(request, 'rep')
        if (!sessionValidation.isValid) {
          console.warn(`Unauthorized rep API access from IP: ${clientIP}`);
          return new NextResponse('Unauthorized', { 
            status: 401,
            headers: { ...securityHeaders, ...(isProd ? { 'X-Frame-Options': 'DENY' } : {}) }
          })
        }
      }
    }
  }
  
  // Page route protection
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    // Skip session validation for login page
    if (!pathname.includes('/pin')) {
      const sessionValidation = await validateSession(request, 'admin')
      if (!sessionValidation.isValid) {
        const loginUrl = new URL('/admin/pin', request.url)
        return NextResponse.redirect(loginUrl)
      }
    }
  }
  
  if (pathname === '/vendor' || pathname.startsWith('/vendor/')) {
    // Skip session validation for the public login page
    if (!pathname.includes('/login')) {
      const sessionValidation = await validateSession(request, 'vendor')
      if (!sessionValidation.isValid) {
        const loginUrl = new URL('/vendor/login', request.url)
        return NextResponse.redirect(loginUrl)
      }
    }
  }

  if (pathname === '/rep' || pathname.startsWith('/rep/')) {
    // Skip session validation for public rep entry pages
    if (!(pathname.includes('/login') || pathname.includes('/access'))) {
      const sessionValidation = await validateSession(request, 'rep')
      if (!sessionValidation.isValid) {
        const loginUrl = new URL('/rep/access', request.url)
        return NextResponse.redirect(loginUrl)
      }

      const claim = sessionValidation.claim
      const mod = claim?.module
      if (mod === 'ram' && (pathname.startsWith('/rep/pending') || pathname.startsWith('/rep/posted') || pathname.startsWith('/rep/delivered') || pathname.startsWith('/rep/banks') || pathname.startsWith('/rep/survey'))) {
        const dest = new URL('/rep/ram/approved', request.url)
        return NextResponse.redirect(dest)
      }
      if (mod === 'exhibition' && (pathname.startsWith('/rep/pending') || pathname.startsWith('/rep/posted') || pathname.startsWith('/rep/delivered') || pathname.startsWith('/rep/banks') || pathname.startsWith('/rep/ram/') || pathname.startsWith('/rep/survey'))) {
        const dest = new URL('/rep/exhibition/pending', request.url)
        return NextResponse.redirect(dest)
      }
      if ((mod === 'food' || mod === 'ram') && pathname.startsWith('/rep/exhibition')) {
        const dest = new URL(mod === 'ram' ? '/rep/ram/approved' : '/rep/pending', request.url)
        return NextResponse.redirect(dest)
      }
      if (mod === 'food' && pathname.startsWith('/rep/ram/')) {
        const dest = new URL('/rep/pending', request.url)
        return NextResponse.redirect(dest)
      }
    }
  }
  
  // Log security events
  if (pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
    console.log(`Admin access: ${pathname} from IP: ${clientIP} at ${new Date().toISOString()}`);
  }
  
  return response
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    // Every path must reach the middleware so agents get Markdown content
    // negotiation on pages and a Markdown body on 404s for paths that do not
    // exist at all. Static assets early-return in-code (isAssetPath).
    '/',
    '/:path*',
    // Original security surface, kept explicit:
    '/api/:path*',
    '/admin/:path*',
    '/rep/:path*',
    '/vendor',
    '/vendor/:path*',
    '/shop/:path*',
    '/exhibition/:path*',
    '/uploads'
  ]
}
