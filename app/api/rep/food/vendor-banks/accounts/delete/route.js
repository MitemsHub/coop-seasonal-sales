import { NextResponse } from 'next/server'
import { isMissingTable, loadRepFoodWriteContext } from '@/lib/repFoodBankGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const ctx = await loadRepFoodWriteContext(req)
    if (ctx.response) return ctx.response
    const { supabase, branchId, cycleId } = ctx

    const body = await req.json().catch(() => ({}))
    const accountId = Number(body.account_id)
    if (!Number.isFinite(accountId) || accountId <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid account_id' }, { status: 400 })
    }

    const { data: row, error: rowErr } = await supabase
      .from('food_vendor_bank_accounts')
      .select('id,is_current,account_number,is_paid')
      .eq('id', accountId)
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .maybeSingle()

    if (rowErr && !isMissingTable(rowErr, 'food_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: rowErr.message }, { status: 500 })
    }
    if (!row?.id) return NextResponse.json({ ok: false, error: 'Bank account not found' }, { status: 404 })
    if (row.is_paid) {
      return NextResponse.json(
        { ok: false, error: 'This bank account is marked as Paid. Mark it unpaid before removing it.' },
        { status: 403 }
      )
    }

    const { error: delErr } = await supabase
      .from('food_vendor_bank_accounts')
      .delete()
      .eq('id', accountId)
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, deleted_id: accountId })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
