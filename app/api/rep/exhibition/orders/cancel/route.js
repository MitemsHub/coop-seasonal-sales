// app/api/rep/exhibition/orders/cancel/route.js
// Reps do NOT cancel exhibition orders — cancellation is the admin's decision
// (/api/admin/exhibition/orders/cancel). A rep's only action is marking an
// approved order before the member confirms receipt.
import { NextResponse } from 'next/server'
import { getRepBranch } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  const auth = getRepBranch(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

  return NextResponse.json(
    { ok: false, error: 'Reps cannot cancel exhibition orders. An admin can cancel or restore them.' },
    { status: 403 }
  )
}
