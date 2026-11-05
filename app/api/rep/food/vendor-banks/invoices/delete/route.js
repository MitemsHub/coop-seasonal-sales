import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

async function resolveActiveCycleId(supabase) {
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

async function isPaidLocked(supabase, branchId, cycleId) {
  if (!cycleId) return false
  const { data, error } = await supabase
    .from('food_vendor_payment_status')
    .select('is_paid')
    .eq('branch_id', branchId)
    .eq('cycle_id', cycleId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error, 'food_vendor_payment_status')) return false
    throw error
  }
  return !!data?.is_paid
}

export async function DELETE(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module && session.claims.module !== 'food') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const branchId = Number(session?.claims?.branch_id)
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const invoiceId = asInt(searchParams.get('invoice_id') || searchParams.get('id'), 0)
    if (!invoiceId) return NextResponse.json({ ok: false, error: 'invoice_id required' }, { status: 400 })

    const supabase = createClient()
    const cycleId = await resolveActiveCycleId(supabase)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const locked = await isPaidLocked(supabase, branchId, cycleId).catch(() => false)
    if (locked) return NextResponse.json({ ok: false, error: 'Branch is marked as Paid. Editing is locked.' }, { status: 403 })

    const { data: inv, error: selErr } = await supabase
      .from('food_vendor_invoices')
      .select('id,branch_id,cycle_id,storage_bucket,storage_path')
      .eq('id', invoiceId)
      .maybeSingle()
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })
    if (!inv) return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 })
    if (Number(inv.branch_id) !== Number(branchId)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

    const bucket = String(inv.storage_bucket || '')
    const path = String(inv.storage_path || '')
    if (bucket && path) {
      const { error: rmErr } = await supabase.storage.from(bucket).remove([path])
      if (rmErr) return NextResponse.json({ ok: false, error: rmErr.message }, { status: 500 })
    }

    const { error: delErr } = await supabase.from('food_vendor_invoices').delete().eq('id', invoiceId)
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

