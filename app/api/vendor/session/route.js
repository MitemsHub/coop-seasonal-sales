import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { sign, verify } from '@/lib/signingEdge'
import { hashPasscode, passcodeLookup, verifyPasscode } from '@/lib/passcodeHash'
import { isMissingEncryptedColumn, tryEncryptPasscode } from '@/lib/passcodeVault'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Rate limiting & brute-force protection ───────────────────────
// Two independent, in-memory guards (swap for Redis if the app runs on more
// than one instance):
//
//  1. Per vendor code — the real account protection, with escalating backoff.
//     Locking follows the code the attacker guesses, not the network it came
//     from, so a hub sharing one IP never loses access because a neighbour
//     mistyped their passcode.
//  2. Per IP — a coarse abuse guard with a deliberately high ceiling. At a
//     market, dozens of vendors can sit behind one NAT address, so ordinary
//     typos must not trip it.
const codeFailures = new Map() // code → { failures, windowStart, lockedUntil }
const ipAttempts = new Map()   // ip → { count, windowStart, lockedUntil }

const CODE_FAILURE_WINDOW_MS = 15 * 60 * 1000 // failures older than this don't accumulate
const CODE_LOCK_THRESHOLD = 5                 // failures in the window before any lock
const CODE_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]

const IP_MAX_ATTEMPTS = 60              // across every code, per window
const IP_WINDOW_MS = 10 * 60 * 1000
const IP_LOCKOUT_MS = 10 * 60 * 1000

const STORE_PRUNE_AT = 1000

function getClientIP(req) {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('x-vercel-forwarded-for') || 'unknown'
}

// Drop expired codes and IPs so the maps cannot grow without bound.
function pruneStores(now) {
  for (const [code, state] of codeFailures) {
    const expiresAt = Math.max(state.lockedUntil || 0, state.windowStart + CODE_FAILURE_WINDOW_MS)
    if (now > expiresAt) codeFailures.delete(code)
  }
  for (const [ip, state] of ipAttempts) {
    const expiresAt = Math.max(state.lockedUntil || 0, state.windowStart + IP_WINDOW_MS)
    if (now > expiresAt) ipAttempts.delete(ip)
  }
}

function checkIpThrottle(ip) {
  const now = Date.now()
  if (codeFailures.size > STORE_PRUNE_AT || ipAttempts.size > STORE_PRUNE_AT) pruneStores(now)

  const record = ipAttempts.get(ip)
  if (record?.lockedUntil && now < record.lockedUntil) {
    return { allowed: false, retryAfterMs: record.lockedUntil - now }
  }
  if (!record || now - record.windowStart > IP_WINDOW_MS) {
    ipAttempts.set(ip, { count: 1, windowStart: now, lockedUntil: 0 })
    return { allowed: true }
  }

  record.count += 1
  if (record.count > IP_MAX_ATTEMPTS) {
    record.lockedUntil = now + IP_LOCKOUT_MS
    console.warn(`Coarse IP throttle tripped for ${ip} (${record.count} attempts)`)
    return { allowed: false, retryAfterMs: IP_LOCKOUT_MS }
  }

  return { allowed: true }
}

function checkCodeLock(code) {
  const now = Date.now()
  const state = codeFailures.get(code)
  if (!state?.lockedUntil || now >= state.lockedUntil) return { allowed: true }
  return { allowed: false, retryAfterMs: state.lockedUntil - now }
}

function recordCodeFailure(code) {
  const now = Date.now()
  const state = codeFailures.get(code) || { failures: 0, windowStart: now, lockedUntil: 0 }
  if (now - state.windowStart > CODE_FAILURE_WINDOW_MS) {
    state.failures = 0
    state.windowStart = now
  }
  state.failures += 1
  if (state.failures >= CODE_LOCK_THRESHOLD) {
    const step = Math.min(state.failures - CODE_LOCK_THRESHOLD, CODE_BACKOFF_MS.length - 1)
    state.lockedUntil = now + CODE_BACKOFF_MS[step]
  }
  codeFailures.set(code, state)
  return state
}

function clearCodeFailures(code) {
  codeFailures.delete(code)
}

function tooManyAttemptsResponse(retryAfterMs) {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000))
  return NextResponse.json(
    {
      ok: false,
      error: `Too many failed attempts. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
  )
}


export async function GET(req) {
  try {
    const token = req.cookies.get('vendor_token')?.value
    if (!token) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
    const claim = await verify(token)
    if (!claim || claim.role !== 'vendor') {
      return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 })
    }

    const supabase = createClient()
    const { data: vendor, error: vendorErr } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id, name, code, phone, address, status, branches:branch_id(name, code)')
      .eq('id', claim.vendor_id)
      .maybeSingle()
    if (vendorErr) {
      // A failed lookup is not a signed-out vendor — say so instead of a 401.
      console.error('Vendor session lookup failed:', vendorErr)
      return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
    if (!vendor) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 401 })

    const { data: cycle, error: cycleErr } = await supabase
      .from('exhibition_cycles')
      .select('id, name, status, starts_at, ends_at')
      .eq('id', vendor.cycle_id)
      .maybeSingle()
    if (cycleErr) {
      console.error('Vendor cycle lookup failed:', cycleErr)
      return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      vendor: {
        id: Number(vendor.id),
        name: vendor.name || '',
        code: vendor.code || '',
        phone: vendor.phone || '',
        address: vendor.address || '',
        cycle_id: Number(vendor.cycle_id),
        branch: vendor.branches?.name || '',
        branch_code: vendor.branches?.code || '',
      },
      cycle: cycle
        ? {
            id: Number(cycle.id),
            name: cycle.name || '',
            status: cycle.status || 'draft',
            starts_at: cycle.starts_at,
            ends_at: cycle.ends_at,
          }
        : null,
    })
  } catch (e) {
    console.error('Vendor session introspection error:', e)
    return NextResponse.json({ ok: false, error: 'Something went wrong. Please sign in again.' }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('vendor_token', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}

// Best-effort: remember a wrong-passcode attempt against the vendor so admins
// can see who tried the credentials we sent but could not get in. Never blocks
// the response, and keeps working before migrations/add-exhibition-vendor-failed-logins.sql
// has run.
async function recordFailedLogin(supabase, vendorId) {
  try {
    const { data: current, error: readError } = await supabase
      .from('exhibition_vendors')
      .select('failed_login_count')
      .eq('id', vendorId)
      .maybeSingle()
    if (readError) {
      console.error('Vendor failed_login_count read failed:', readError)
      return
    }
    const { error: writeError } = await supabase
      .from('exhibition_vendors')
      .update({
        failed_login_count: Number(current?.failed_login_count || 0) + 1,
        last_failed_login_at: new Date().toISOString(),
      })
      .eq('id', vendorId)
    if (writeError) console.error('Vendor failed_login_count update failed:', writeError)
  } catch (e) {
    console.error('Vendor failed sign-in tracking failed:', e)
  }
}

export async function POST(req) {
  try {
    const ip = getClientIP(req)
    const supabase = createClient()
    const body = await req.json().catch(() => ({}))
    const code = String(body?.code || '').trim().toUpperCase()
    const passcode = String(body?.passcode || '').trim()
    if (!code || !passcode) {
      return NextResponse.json({ ok: false, error: 'Vendor code and passcode are required' }, { status: 400 })
    }

    // Coarse network guard first, then the per-code backoff that actually
    // protects the account.
    const ipGuard = checkIpThrottle(ip)
    if (!ipGuard.allowed) return tooManyAttemptsResponse(ipGuard.retryAfterMs)
    const codeGuard = checkCodeLock(code)
    if (!codeGuard.allowed) return tooManyAttemptsResponse(codeGuard.retryAfterMs)

    const { data: vendor, error } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id, name, code, passcode, passcode_lookup, phone, status, branches:branch_id(name, code)')
      .eq('code', code)
      .maybeSingle()

    if (error) {
      if (String(error?.code || '') === '42P01') {
        return NextResponse.json(
          { ok: false, error: 'The Coop Exhibition is not available yet. Please try again soon.' },
          { status: 500 }
        )
      }
      console.error('Vendor lookup failed:', error)
      return NextResponse.json({ ok: false, error: 'Something went wrong while checking your credentials. Please try again.' }, { status: 500 })
    }

    if (!vendor) {
      // Guess attempts against unknown codes back off too, but there is no
      // vendor row to count them against in the database.
      recordCodeFailure(code)
      console.warn(`Failed vendor login attempt for code=${code} from IP: ${ip}`)
      return NextResponse.json({ ok: false, error: 'Unknown vendor code. Please select your hub and try again.' }, { status: 401 })
    }
    const passcodeCheck = await verifyPasscode(passcode, String(vendor.passcode || ''))
    if (!passcodeCheck.ok) {
      recordCodeFailure(code)
      console.warn(`Failed vendor login attempt for code=${code} from IP: ${ip}`)
      await recordFailedLogin(supabase, vendor.id)
      return NextResponse.json({ ok: false, error: 'Incorrect passcode. Please check it and try again.' }, { status: 401 })
    }
    // Legacy rows still hold the passcode in plaintext — replace it the first
    // time the vendor signs in successfully so no plaintext credential survives.
    // This is also the earliest safe point to fingerprint an older passcode for
    // the global uniqueness check, because only now is its plaintext known.
    if (passcodeCheck.needsRehash || !vendor.passcode_lookup) {
      const updates = { passcode_lookup: passcodeLookup(passcode) }
      if (passcodeCheck.needsRehash) updates.passcode = await hashPasscode(passcode)
      // This is also the one moment an older passcode's plaintext is visible, so
      // keep the recoverable copy for admins while we are here.
      const encrypted = tryEncryptPasscode(passcode)
      if (encrypted) updates.passcode_encrypted = encrypted

      let { error: upgradeError } = await supabase.from('exhibition_vendors').update(updates).eq('id', vendor.id)
      // Never leave plaintext (or a stale lookup) behind just because the
      // encryption migration has not run: retry without the copy.
      if (isMissingEncryptedColumn(upgradeError)) {
        delete updates.passcode_encrypted
        ;({ error: upgradeError } = await supabase.from('exhibition_vendors').update(updates).eq('id', vendor.id))
      }
      if (upgradeError) console.error('Vendor passcode upgrade failed:', upgradeError)
    }
    if (vendor.status !== 'active') {
      return NextResponse.json({ ok: false, error: 'This vendor account is not active. Please contact your administrator.' }, { status: 403 })
    }

    // A correct passcode clears that code's backoff: a vendor who finally gets
    // in starts fresh, even if their neighbours keep failing.
    clearCodeFailures(code)

    // Record the sign-in for the admin's "signed in X / Y" counter. Failure
    // here (e.g. the column isn't migrated yet) must never block the login.
    try {
      const signedInAt = new Date().toISOString()
      // Clear the failed-attempt counter too: a vendor who struggled once and
      // then got in should stop showing up as a credential problem.
      const { error: stampError } = await supabase
        .from('exhibition_vendors')
        .update({ last_login_at: signedInAt, failed_login_count: 0 })
        .eq('id', vendor.id)
      if (stampError) {
        if (String(stampError.code || '') === '42703' && String(stampError.message || '').includes('failed_login_count')) {
          // Schema without the failed-attempt columns: the sign-in timestamp
          // still matters, so retry with just that.
          const { error: retryError } = await supabase
            .from('exhibition_vendors')
            .update({ last_login_at: signedInAt })
            .eq('id', vendor.id)
          if (retryError) console.error('Vendor last_login_at update failed:', retryError)
        } else {
          console.error('Vendor sign-in update failed:', stampError)
        }
      }
    } catch (e) {
      console.error('Vendor sign-in update failed:', e)
    }

    // Resolve the vendor's cycle for context (name/status surfaced in the portal).
    const { data: cycle, error: cycleErr } = await supabase
      .from('exhibition_cycles')
      .select('id, name, status, branch_id')
      .eq('id', vendor.cycle_id)
      .maybeSingle()
    if (cycleErr && String(cycleErr?.code || '') !== '42P01') {
      console.error('Vendor cycle lookup failed:', cycleErr)
      return NextResponse.json({ ok: false, error: 'Something went wrong while loading your cycle. Please try again.' }, { status: 500 })
    }

    const token = await sign(
      {
        role: 'vendor',
        vendor_id: Number(vendor.id),
        vendor_code: code,
        cycle_id: Number(vendor.cycle_id),
        branch_id: Number(vendor.branch_id),
      },
      60 * 60 * 8 // 8h
    )

    const res = NextResponse.json({
      ok: true,
      vendor: {
        id: Number(vendor.id),
        name: vendor.name || '',
        code,
        phone: vendor.phone || '',
        cycle_id: Number(vendor.cycle_id),
        branch: vendor.branches?.name || '',
        branch_code: vendor.branches?.code || '',
      },
      cycle: cycle
        ? { id: Number(cycle.id), name: cycle.name || '', status: cycle.status || 'draft' }
        : null,
    })
    res.cookies.set('vendor_token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8 })
    return res
  } catch (e) {
    console.error('Vendor session error:', e)
    return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
