import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

async function resolveActiveCycleId(supabase, cycleIdRaw) {
  if (cycleIdRaw != null && cycleIdRaw !== '') {
    const n = Number(cycleIdRaw)
    if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid cycle_id')
    return Math.trunc(n)
  }
  const { data, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.id) return data.id
    // A closed season must not block this screen: fall back to the newest
    // cycle that actually has orders (lib/orderCycle does the same for lists).
    const { data: latestCycle } = await supabase
      .from('orders')
      .select('cycle_id')
      .not('cycle_id', 'is', null)
      .order('order_id', { ascending: false })
      .limit(1)
      .maybeSingle()
    return latestCycle?.cycle_id ?? null
}

function cleanText(v, maxLen = 500) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

export async function POST(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const body = await req.json().catch(() => ({}))
    const branchId = asInt(body.branch_id || body.delivery_branch_id, 0)
    if (!branchId) return NextResponse.json({ ok: false, error: 'branch_id required' }, { status: 400 })

    const cycleId = await resolveActiveCycleId(supabase, body.cycle_id)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const isPaid = !!body.is_paid
    const notes = cleanText(body.notes, 1000) || null
    const paidBy = cleanText(session?.claims?.email || session?.claims?.user || 'admin', 120) || 'admin'
    const now = new Date().toISOString()

    const payload = {
      branch_id: branchId,
      cycle_id: cycleId,
      is_paid: isPaid,
      paid_at: isPaid ? now : null,
      paid_by: isPaid ? paidBy : null,
      notes,
      updated_at: now,
    }

    const { data, error } = await supabase
      .from('food_vendor_payment_status')
      .upsert(payload, { onConflict: 'branch_id,cycle_id' })
      .select('branch_id,cycle_id,is_paid,paid_at,paid_by,notes')
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, paid: data || payload })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

