import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { resolveFoodCycle } from '@/lib/cycleResolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

// Cycle resolution is shared with the invoice routes (lib/cycleResolve).
async function resolveActiveCycleId(supabase) {
  return resolveFoodCycle(supabase)
}

async function paidStatus(supabase, branchId, cycleId) {
  if (!cycleId) return { is_paid: false, paid_at: null, cycle_id: null }
  const { data, error } = await supabase
    .from('food_vendor_payment_status')
    .select('is_paid,paid_at,cycle_id')
    .eq('branch_id', branchId)
    .eq('cycle_id', cycleId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error, 'food_vendor_payment_status')) return { is_paid: false, paid_at: null, cycle_id: cycleId }
    throw error
  }
  return { is_paid: !!data?.is_paid, paid_at: data?.paid_at || null, cycle_id: data?.cycle_id ?? cycleId }
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module && session.claims.module !== 'food') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const branchId = Number(session?.claims?.branch_id)
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createClient()
    const cycle = await resolveActiveCycleId(supabase)
    if (!cycle?.id) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const { data: branch, error: bErr } = await supabase.from('branches').select('id,code,name').eq('id', branchId).maybeSingle()
    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    if (!branch?.id) return NextResponse.json({ ok: false, error: 'Branch not found' }, { status: 404 })

    const [bankRes, invRes, paid] = await Promise.all([
      supabase
        .from('food_vendor_bank_accounts')
        .select('id,branch_id,cycle_id,bank_name,account_name,account_number,is_current,created_at,created_by_role,created_by_code')
        .eq('branch_id', branchId)
        .eq('cycle_id', cycle.id)
        .order('is_current', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('food_vendor_invoices')
        .select('id,branch_id,cycle_id,bank_account_id')
        .eq('branch_id', branchId)
        .eq('cycle_id', cycle.id),
      paidStatus(supabase, branchId, cycle.id),
    ])

    if (bankRes.error && !isMissingTable(bankRes.error, 'food_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: bankRes.error.message }, { status: 500 })
    }
    if (invRes.error && !isMissingTable(invRes.error, 'food_vendor_invoices')) {
      return NextResponse.json({ ok: false, error: invRes.error.message }, { status: 500 })
    }

    const invoiceRows = Array.isArray(invRes.data) ? invRes.data : []
    const invoiceCountByBank = new Map()
    for (const inv of invoiceRows) {
      const bid = Number(inv?.bank_account_id)
      if (!Number.isFinite(bid) || bid <= 0) continue
      invoiceCountByBank.set(bid, (invoiceCountByBank.get(bid) || 0) + 1)
    }

    // Each account carries how many invoices are filed against it, so the page
    // can show the relationship without a second round trip.
    const banks = (Array.isArray(bankRes.data) ? bankRes.data : []).map((b) => ({
      ...b,
      invoice_count: invoiceCountByBank.get(Number(b.id)) || 0,
    }))
    const currentBank = banks.find((b) => b.is_current) || null
    const invoiceCount = invoiceRows.length
    return NextResponse.json({
      ok: true,
      cycle: { id: cycle.id, code: cycle.code || '', name: cycle.name || '' },
      branch: { id: branch.id, code: branch.code || '', name: branch.name || '' },
      bank: currentBank,
      banks,
      invoice_count: invoiceCount,
      paid,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

