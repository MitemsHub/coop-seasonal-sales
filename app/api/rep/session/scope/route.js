// app/api/rep/session/scope/route.js
// POST { department } — binds (or clears) a food department rep's scope in the
// signed rep_token cookie.
//
// Why this exists: the department question is asked on EVERY login (a branch
// rep and a department rep share the same branch passcode), but the answer
// used to live only in client state. A reload re-hydrated the session from
// GET /api/rep/session without it, so the rep silently fell back to the whole
// branch and the department filter disappeared — the rep saw every order of
// every department. The scope now lives in the httpOnly cookie, and the order
// list / stats / items-pack APIs enforce it server-side.
//
// Only the food module has departments; ram and exhibition are rejected.
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { verify, sign } from '@/lib/signingEdge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const token = req.cookies.get('rep_token')?.value
    const claim = token && (await verify(token))
    if (!claim || claim.role !== 'rep') return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    if (claim.module && claim.module !== 'food') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    if (!Number.isFinite(Number(claim.branch_id)) || Number(claim.branch_id) <= 0) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const department = String(body?.department || '').trim()

    let departmentId = null
    if (department) {
      const supabase = createClient()
      const { data, error } = await supabase.from('departments').select('id, name').eq('name', department).maybeSingle()
      if (error) return NextResponse.json({ ok: false, error: 'Could not verify your department. Please try again.' }, { status: 500 })
      if (!data?.id) return NextResponse.json({ ok: false, error: 'Unknown department. Please pick one from the list.' }, { status: 400 })
      departmentId = Number(data.id)
    }

    const nextClaim = {
      role: 'rep',
      module: claim.module || 'food',
      branch_id: Number(claim.branch_id),
      branch_code: claim.branch_code || '',
      branch_name: claim.branch_name || '',
      ...(department ? { department, department_id: departmentId } : {}),
    }
    const nextToken = await sign(nextClaim, 60 * 60 * 8) // same 8h life as login

    const res = NextResponse.json({
      ok: true,
      department: department || '',
      department_id: departmentId,
      branch_id: nextClaim.branch_id,
      branch_code: nextClaim.branch_code,
      branch_name: nextClaim.branch_name,
    })
    res.cookies.set('rep_token', nextToken, { httpOnly: true, sameSite: 'lax', path: '/' })
    return res
  } catch (e) {
    console.error('Rep session scope error:', e)
    return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
