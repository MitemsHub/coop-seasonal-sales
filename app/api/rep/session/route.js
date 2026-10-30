import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'
import { sign, verify } from '@/lib/signingEdge'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    if (record.count >= LOCKOUT_THRESHOLD) {
      lockoutStore.set(ip, now + LOCKOUT_MS)
      console.warn(`Rep session lockout triggered for IP: ${ip}`)
      return { allowed: false, reason: 'locked' }
    }
    return { allowed: false, reason: 'rate_limited' }
  }

  return { allowed: true }
}

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

async function resolveActiveRamCycleId(supabase) {
  const { data: active, error: aErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (aErr) {
    if (isMissingTable(aErr, 'ram_cycles')) return null
    throw aErr
  }
  if (active?.id) return active.id
  const { data: latest, error: lErr } = await supabase.from('ram_cycles').select('id').order('created_at', { ascending: false }).maybeSingle()
  if (lErr) {
    if (isMissingTable(lErr, 'ram_cycles')) return null
    throw lErr
  }
  return latest?.id || null
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('rep_token', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}

// GET — introspection for the client-side auth gate (ProtectedRoute): returns
// the signed-in rep session when a valid rep_token cookie is present, so a
// cold load with a valid cookie but no localStorage user can hydrate the
// session (including the module) instead of bouncing to the landing page.
export async function GET(req) {
  try {
    const token = req.cookies.get('rep_token')?.value
    if (!token) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
    const claim = await verify(token)
    if (!claim || claim.role !== 'rep') {
      return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 })
    }
    const mod = claim.module === 'ram' ? 'ram' : claim.module === 'exhibition' ? 'exhibition' : 'food'
    return NextResponse.json({
      ok: true,
      type: 'rep',
      id: String(claim.branch_code || claim.ram_vendor_code || 'rep'),
      module: mod,
      ...(claim.branch_id ? { branch_id: claim.branch_id } : {}),
      ...(claim.branch_code ? { branch_code: claim.branch_code } : {}),
      ...(claim.branch_name ? { branch_name: claim.branch_name } : {}),
      // A department rep's scope rides in the signed cookie, so a page reload
      // keeps it: the client never stores auth data itself.
      ...(claim.department ? { department: claim.department } : {}),
      ...(claim.department_id ? { department_id: claim.department_id } : {}),
    })
  } catch (e) {
    console.error('Rep session introspection error:', e)
    return NextResponse.json({ ok: false, error: 'Something went wrong. Please sign in again.' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const ip = getClientIP(req)

    // Brute-force check
    const bf = checkBruteForce(ip)
    if (!bf.allowed) {
      let lockMessage
      if (bf.reason === 'locked') {
        lockMessage = 'Too many failed attempts. Sign-in is temporarily locked — please try again in about an hour.'
      } else {
        lockMessage = 'Too many attempts. Please wait a few minutes and try again.'
      }
      return NextResponse.json({ ok: false, error: lockMessage }, { status: 429 })
    }

    const supabase = createClient()
    const body = await req.json().catch(() => ({}))
    const rawModule = String(body?.module || 'food').toLowerCase()
    const portalModule = rawModule === 'ram' ? 'ram' : rawModule === 'exhibition' ? 'exhibition' : 'food'
    const code = String(body?.passcode || body?.branchCode || '').trim().toUpperCase()
    if (!code) return NextResponse.json({ ok:false, error:'Passcode is required. Please enter it and try again.' }, { status:400 })

    if (portalModule === 'ram') {
      const { data: vendors, error } = await supabase
        .from('ram_delivery_locations')
        .select('id, delivery_location, name, rep_code, is_active')
        .eq('rep_code', code)
        .eq('is_active', true)
        .order('id', { ascending: true })
      if (error && isMissingTable(error, 'ram_delivery_locations')) {
        console.error('Ram vendor lookup failed: ram_delivery_locations table is missing')
        return NextResponse.json(
          { ok: false, error: 'Ram Sales vendors are not set up yet. Please contact support and try again later.' },
          { status: 500 }
        )
      }
      if (error) {
        console.error('Ram vendor lookup failed:', error)
        return NextResponse.json({ ok: false, error: 'Something went wrong while checking your passcode. Please try again.' }, { status: 500 })
      }
      let list = Array.isArray(vendors) ? vendors.filter((v) => v && v.id) : []
      if (!list.length) {
        console.warn(`Failed rep login attempt for code=${code} (ram) from IP: ${ip}`)
        return NextResponse.json({ ok: false, error: 'Incorrect passcode. Please check it and try again.' }, { status: 401 })
      }
      let ids = list.map((v) => Number(v.id)).filter((n) => Number.isFinite(n) && n > 0)

      const cycleId = await resolveActiveRamCycleId(supabase).catch(() => null)
      if (cycleId) {
        const { data: links, error: linkErr } = await supabase
          .from('ram_cycle_delivery_locations')
          .select('ram_delivery_location_id,is_active')
          .eq('ram_cycle_id', cycleId)
          .eq('is_active', true)
          .in('ram_delivery_location_id', ids)
        if (linkErr) {
          if (!isMissingTable(linkErr, 'ram_cycle_delivery_locations')) {
            console.error('Ram cycle link lookup failed:', linkErr)
            return NextResponse.json({ ok: false, error: 'Something went wrong while checking your passcode. Please try again.' }, { status: 500 })
          }
        } else {
          const allowed = new Set((links || []).map((r) => Number(r.ram_delivery_location_id)).filter((n) => Number.isFinite(n) && n > 0))
          list = list.filter((v) => allowed.has(Number(v.id)))
          ids = list.map((v) => Number(v.id)).filter((n) => Number.isFinite(n) && n > 0)
        }
      }

      if (!list.length) {
        console.warn(`Failed rep login attempt for code=${code} (ram cycle mismatch) from IP: ${ip}`)
        return NextResponse.json({ ok: false, error: 'This passcode is not active for the current cycle. Please contact your coordinator.' }, { status: 401 })
      }
      const first = list[0]

      const token = await sign(
        {
          role: 'rep',
          module: 'ram',
          ram_delivery_location_id: first.id,
          ram_delivery_location_ids: ids,
          ram_vendor_code: code,
        },
        60 * 60 * 8
      )
      const res = NextResponse.json({
        ok: true,
        module: 'ram',
        vendor: {
          id: first.id,
          ids,
          name: first.delivery_location || first.name || '',
          code,
        },
      })
      // Browser-session cookie (no maxAge): closing the browser ends the
      // session, so the next visit always asks for the passcode again.
      res.cookies.set('rep_token', token, { httpOnly: true, sameSite: 'lax', path: '/' })
      return res
    }

    // Food + Exhibition both authenticate with the branch passcode and carry
    // a branch_id claim (exhibition is branch-scoped like Food).
    const { data: br, error } = await supabase.from('branches').select('id, code, name, rep_phone').eq('code', code).single()
    if (error && String(error?.code || '') !== 'PGRST116') {
      console.error('Branch lookup failed:', error)
      return NextResponse.json({ ok:false, error:'Something went wrong while checking your passcode. Please try again.' }, { status: 500 })
    }
    if (!br) {
      console.warn(`Failed rep login attempt for code=${code} (food/exhibition) from IP: ${ip}`)
      return NextResponse.json({ ok:false, error:'Incorrect passcode. Please check it and try again.' }, { status:401 })
    }

    const token = await sign({ role: 'rep', module: portalModule, branch_id: br.id, branch_code: br.code, branch_name: br.name || '' }, 60 * 60 * 8) // 8h token
    const res = NextResponse.json({ ok:true, module: portalModule, branch: br, rep_phone: br.rep_phone || '' })
    // Browser-session cookie (no maxAge): closing the browser ends the
    // session, so the next visit always asks for the passcode again.
    res.cookies.set('rep_token', token, { httpOnly: true, sameSite: 'lax', path: '/' })
    return res
  } catch (e) {
    console.error('Rep session error:', e)
    return NextResponse.json({ ok:false, error:'Something went wrong. Please try again.' }, { status:500 })
  }
}
