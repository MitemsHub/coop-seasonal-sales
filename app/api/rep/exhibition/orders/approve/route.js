// app/api/rep/exhibition/orders/approve/route.js
// Reps do NOT approve exhibition orders — approval is the admin's decision
// (/api/admin/exhibition/orders/approve). This endpoint stays only to answer a
// stale client clearly instead of silently doing nothing.
import { NextResponse } from 'next/server'
import { getRepBranch } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const auth = getRepBranch(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

  return NextResponse.json(
    { ok: false, error: 'Reps cannot approve exhibition orders. An admin approves them.' },
    { status: 403 }
  )
}
