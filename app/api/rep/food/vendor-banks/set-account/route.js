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

function cleanText(v, maxLen = 120) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
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

export async function POST(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module && session.claims.module !== 'food') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const branchId = Number(session?.claims?.branch_id)
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const bankName = cleanText(body.bank_name, 120)
    const accountName = cleanText(body.account_name, 120)
    const accountNumber = cleanText(body.account_number, 40)

    const supabase = createClient()
    const cycleId = await resolveActiveCycleId(supabase)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const locked = await isPaidLocked(supabase, branchId, cycleId).catch(() => false)
    if (locked) return NextResponse.json({ ok: false, error: 'Branch is marked as Paid. Editing is locked.' }, { status: 403 })

    const { error: clearErr } = await supabase
      .from('food_vendor_bank_accounts')
      .update({ is_current: false })
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .eq('is_current', true)
    if (clearErr && !isMissingTable(clearErr, 'food_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: clearErr.message }, { status: 500 })
    }

    const createdByCode = cleanText(session?.claims?.branch_code || session?.claims?.rep_code || '', 120) || null
    const { data: bank, error } = await supabase
      .from('food_vendor_bank_accounts')
      .insert({
        branch_id: branchId,
        cycle_id: cycleId,
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber,
        is_current: true,
        created_by_role: 'rep',
        created_by_code: createdByCode,
      })
      .select('id,branch_id,cycle_id,bank_name,account_name,account_number,is_current,created_at,created_by_role,created_by_code')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, bank })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

