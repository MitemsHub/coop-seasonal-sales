// lib/memberScope.js
// Resolve whose member record a member-facing API call is allowed to touch.
//
// These routes used to take the member id from ?member_id= / body.member_id,
// so any caller could read — or spend against — another member's account.
// Ownership now comes from the signed cookie session: a member is always
// scoped to their own id, whatever the request claims, while trusted staff
// roles may still name another member for back-office/admin screens.
//
// Callers keep sending the member id (the client sends the member's own), so
// this is a server-side trust change, not an API shape change.
import { NextResponse } from 'next/server'
import { validateSession } from './validation'

export function normalizeMemberId(value) {
  return String(value || '').trim().toUpperCase()
}

/**
 * @param {Request} request
 * @param {any} requestedMemberId - member_id from the URL/body (untrusted)
 * @param {{ allow?: string[], signedOutError?: string, forbiddenError?: string }} [options]
 * @returns {Promise<{ok: true, role: string, claims: object, memberId: string, isOwn: boolean}
 *   | {ok: false, response: Response}>}
 */
export async function resolveMemberScope(request, requestedMemberId, options = {}) {
  const allow = options.allow || ['member']

  const session = await validateSession(request)
  if (!session.valid) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: options.signedOutError || 'Please sign in to continue.' },
        { status: 401 }
      ),
    }
  }

  const claims = session.claims || {}
  const role = String(claims.role || '')
  const ownMemberId = normalizeMemberId(claims.member_id)
  const requested = normalizeMemberId(requestedMemberId)

  if (role === 'member') {
    if (!allow.includes('member')) {
      return { ok: false, response: forbidden(options) }
    }
    if (!ownMemberId) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: 'Your session is missing a member id. Please sign in again.' },
          { status: 401 }
        ),
      }
    }
    if (requested && requested !== ownMemberId) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: 'You can only access your own records.' },
          { status: 403 }
        ),
      }
    }
    return { ok: true, role, claims, memberId: ownMemberId, isOwn: true }
  }

  if ((role === 'admin' || role === 'rep') && allow.includes(role)) {
    // Staff sessions carry no member identity, so they must name the member.
    return { ok: true, role, claims, memberId: requested, isOwn: false }
  }

  return { ok: false, response: forbidden(options) }
}

function forbidden(options) {
  return NextResponse.json(
    { ok: false, error: options.forbiddenError || 'This action is not available for your account.' },
    { status: 403 }
  )
}
