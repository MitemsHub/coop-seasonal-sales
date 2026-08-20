// middleware.js
// Comprehensive security middleware for the Coop Seasonal Sales System
import { NextResponse } from 'next/server'

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
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co${isLocalSupabase ? ` ${supabaseUrl}` : ''};`
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
    
    // Import the verify function to validate JWT tokens (Edge Runtime compatible)
    const { verify } = await import('./lib/signingEdge.js')
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
  const clientIP = getClientIP(request)
  
  // Create response with security headers
  const response = NextResponse.next()
  
  // Add security headers to all responses
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  if (isProd) response.headers.set('X-Frame-Options', 'DENY')
  
  // Rate limiting is a production anti-abuse measure. The in-memory store is a
  // dev stand-in (real deployments use Redis), so local development + smoke
  // tests run without throttling — otherwise a long test run trips the window.
  if (isProd) {
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
                          pathname.includes('/auth/forgot-password') ||
                          pathname.includes('/auth/reset-password') ||
                          pathname.includes('/pin/session') ||
                          pathname.includes('/rep/session') ||
                          pathname.includes('/rep/access') ||
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
      if (mod === 'ram' && (pathname.startsWith('/rep/pending') || pathname.startsWith('/rep/posted') || pathname.startsWith('/rep/delivered') || pathname.startsWith('/rep/banks'))) {
        const dest = new URL('/rep/ram/approved', request.url)
        return NextResponse.redirect(dest)
      }
      if (mod === 'exhibition' && (pathname.startsWith('/rep/pending') || pathname.startsWith('/rep/posted') || pathname.startsWith('/rep/delivered') || pathname.startsWith('/rep/banks') || pathname.startsWith('/rep/ram/'))) {
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
    // Match all API routes
    '/api/:path*',
    // Match admin routes
    '/admin/:path*',
    // Match rep routes
    '/rep/:path*',
    // Match vendor routes (incl. the bare /vendor entry)
    '/vendor',
    '/vendor/:path*',
    // Match shop routes (for member protection)
    '/shop/:path*',
    // Match member exhibition routes
    '/exhibition/:path*'
  ]
}
