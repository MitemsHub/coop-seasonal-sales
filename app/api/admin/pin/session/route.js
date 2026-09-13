// app/api/admin/pin/session/route.js
import { NextResponse } from 'next/server'
import { sign, verify } from '@/lib/signing'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const isProd = process.env.NODE_ENV === 'production'

// ── Rate limiting & brute-force protection ───────────────────────
// In-memory stores — production deployments should swap these for Redis.
const attemptStore = new Map()   // key → { count, windowStart }
const lockoutStore = new Map()   // key → lockoutExpiresAt

const MAX_ATTEMPTS = 5           // per window
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const LOCKOUT_THRESHOLD = 10     // attempts before lockout
const LOCKOUT_MS = 60 * 60 * 1000 // 1 hour

function getClientIP(req) {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('x-vercel-forwarded-for') || 'unknown'
}

function checkBruteForce(ip) {
  const now = Date.now()

  // Check lockout
  const lockExpiry = lockoutStore.get(ip)
  if (lockExpiry && now < lockExpiry) {
    return { allowed: false, reason: 'locked' }
  }
  if (lockExpiry && now >= lockExpiry) {
    lockoutStore.delete(ip)
    attemptStore.delete(ip)
  }

  // Check rate limit window
  const record = attemptStore.get(ip)
  if (!record || now - record.windowStart > WINDOW_MS) {
    attemptStore.set(ip, { count: 1, windowStart: now })
    return { allowed: true }
  }

  record.count++
  if (record.count > MAX_ATTEMPTS) {
    // Trigger lockout after LOCKOUT_THRESHOLD
    if (record.count >= LOCKOUT_THRESHOLD) {
      lockoutStore.set(ip, now + LOCKOUT_MS)
      console.warn(`Admin PIN lockout triggered for IP: ${ip}`)
      return { allowed: false, reason: 'locked' }
    }
    return { allowed: false, reason: 'rate_limited' }
  }

  return { allowed: true }
}

// Timing-safe comparison to prevent timing attacks
function timingSafeEqual(a, b) {
  if (!a || !b) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    // Still compare to avoid length-based timing leaks
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length))
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

export async function POST(req) {
  try {
    const ip = getClientIP(req)

    // Brute-force check
    const bf = checkBruteForce(ip)
    if (!bf.allowed) {
      const msg = bf.reason === 'locked'
        ? 'Too many failed attempts. Account temporarily locked (1 hour).'
        : 'Too many attempts. Please try again later.'
      return NextResponse.json({ ok: false, error: msg }, { status: 429 })
    }

    const { passcode } = await req.json()
    const PIN = process.env.ADMIN_PASSCODE
    if (!PIN) {
      console.error('ADMIN_PASSCODE environment variable is not set')
      return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500 })
    }

    // Timing-safe comparison instead of plain ===
    if (!timingSafeEqual(passcode || '', PIN)) {
      console.warn(`Failed admin PIN attempt from IP: ${ip}`)
      return NextResponse.json({ ok: false, error: 'Invalid passcode' }, { status: 401 })
    }

    const token = sign({ role: 'admin' }, 60 * 60 * 8) // 8h
    const res = NextResponse.json({ ok: true })
    res.cookies.set('admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
      secure: isProd,
    })
    return res
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('admin_token', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: isProd,
  })
  return res
}

// GET — introspection for the client-side auth gate (ProtectedRoute): returns
// the signed-in admin when a valid admin_token cookie is present, so a cold
// load with a valid cookie but no localStorage user can hydrate the session
// instead of bouncing to the landing page.
export async function GET(req) {
  try {
    const token = req.cookies.get('admin_token')?.value
    if (!token) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
    const claim = verify(token)
    if (!claim || claim.role !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 })
    }
    return NextResponse.json({ ok: true, type: 'admin', id: 'admin' })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Session error' }, { status: 500 })
  }
}
