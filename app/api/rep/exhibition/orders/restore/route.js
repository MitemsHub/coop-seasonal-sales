// app/api/rep/exhibition/orders/restore/route.js
// Reps do NOT restore cancelled exhibition orders — that is an admin action.
import { NextResponse } from 'next/server'
import { getRepBranch } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const auth = getRepBranch(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

  return NextResponse.json(
    { ok: false, error: 'Reps cannot restore exhibition orders. An admin can restore a cancelled order.' },
    { status: 403 }
  )
}
