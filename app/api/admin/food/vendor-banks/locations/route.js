import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

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

function isMissingColumn(error, columnName) {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const c = String(columnName || '').toLowerCase()
  if (!msg.includes(c)) return false
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('could not find'))
}

async function hasColumn(supabase, tableName, columnName) {
  const { error } = await supabase.from(tableName).select(columnName).limit(1)
  if (!error) return true
  if (isMissingTable(error, tableName)) return false
  if (isMissingColumn(error, columnName)) return false
  throw error
}

async function resolveActiveCycleId(supabase, searchParams) {
  const raw = searchParams.get('cycle_id')
  if (raw != null && raw !== '') {
    const n = Number(raw)
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

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const cycleId = await resolveActiveCycleId(supabase, searchParams)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const { data: branches, error: bErr } = await supabase.from('branches').select('id,code,name').order('name')
    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })

    const branchIds = (branches || []).map((b) => Number(b.id)).filter((n) => Number.isFinite(n) && n > 0)
    if (!branchIds.length) return NextResponse.json({ ok: true, cycle_id: cycleId, locations: [] })

    const [banksRes, invoicesRes, paidRes] = await Promise.all([
      (() => {
        let q = supabase
          .from('food_vendor_bank_accounts')
          .select('id,branch_id,cycle_id,bank_name,account_name,account_number,is_current,created_at,created_by_role,created_by_code')
          .in('branch_id', branchIds)
          .eq('cycle_id', cycleId)
        return q
      })(),
      (() => {
        let q = supabase.from('food_vendor_invoices').select('id,branch_id,cycle_id').in('branch_id', branchIds).eq('cycle_id', cycleId)
        return q
      })(),
      (() => {
        let q = supabase
          .from('food_vendor_payment_status')
          .select('branch_id,cycle_id,is_paid,paid_at')
          .in('branch_id', branchIds)
          .eq('cycle_id', cycleId)
        return q
      })(),
    ])

    if (banksRes.error) {
      if (!isMissingTable(banksRes.error, 'food_vendor_bank_accounts')) {
        return NextResponse.json({ ok: false, error: banksRes.error.message }, { status: 500 })
      }
    }
    if (invoicesRes.error) {
      if (!isMissingTable(invoicesRes.error, 'food_vendor_invoices')) {
        return NextResponse.json({ ok: false, error: invoicesRes.error.message }, { status: 500 })
      }
    }
    if (paidRes.error) {
      if (!isMissingTable(paidRes.error, 'food_vendor_payment_status')) {
        return NextResponse.json({ ok: false, error: paidRes.error.message }, { status: 500 })
      }
    }

    // Every account on file, not just the current one: a branch can keep a
    // second account and switch which one payouts use.
    const banksByBranchId = new Map()
    for (const b of banksRes.data || []) {
      const id = Number(b?.branch_id)
      if (!Number.isFinite(id) || id <= 0) continue
      const list = banksByBranchId.get(id) || []
      list.push(b)
      banksByBranchId.set(id, list)
    }
    for (const list of banksByBranchId.values()) {
      list.sort((a, b) => Number(b.is_current) - Number(a.is_current) || new Date(b.created_at) - new Date(a.created_at))
    }
    const invoiceCountByBranchId = new Map()
    for (const inv of invoicesRes.data || []) {
      const id = Number(inv?.branch_id)
      if (!Number.isFinite(id) || id <= 0) continue
      invoiceCountByBranchId.set(id, (invoiceCountByBranchId.get(id) || 0) + 1)
    }

    const paidByBranchId = new Map()
    for (const p of paidRes.data || []) {
      const id = Number(p?.branch_id)
      if (!Number.isFinite(id) || id <= 0) continue
      paidByBranchId.set(id, { is_paid: !!p?.is_paid, paid_at: p?.paid_at || null, cycle_id: p?.cycle_id ?? cycleId })
    }

    const out = (branches || []).map((b) => {
      const id = Number(b.id)
      const banks = banksByBranchId.get(id) || []
      return {
        id,
        code: b.code || '',
        name: b.name || '',
        bank: banks.find((x) => x.is_current) || banks[0] || null,
        banks,
        invoice_count: invoiceCountByBranchId.get(id) || 0,
        paid: paidByBranchId.get(id) || { is_paid: false, paid_at: null, cycle_id: cycleId },
      }
    })

    const term = String(searchParams.get('term') || '').trim().toLowerCase()
    const filtered = term
      ? out.filter((r) => `${r.code} ${r.name} ${r.bank?.bank_name || ''} ${r.bank?.account_name || ''} ${r.bank?.account_number || ''}`.toLowerCase().includes(term))
      : out

    const hasPolicy = await hasColumn(supabase, 'cycles', 'food_loan_eligible_amount_cap').catch(() => false)
    return NextResponse.json({ ok: true, cycle_id: cycleId, locations: filtered, has_policy: hasPolicy })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

