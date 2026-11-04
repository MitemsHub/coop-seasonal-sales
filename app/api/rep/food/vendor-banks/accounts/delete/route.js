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
      .select('id,is_current,account_number')
      .eq('id', accountId)
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .maybeSingle()

    if (rowErr && !isMissingTable(rowErr, 'food_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: rowErr.message }, { status: 500 })
    }
    if (!row?.id) return NextResponse.json({ ok: false, error: 'Bank account not found' }, { status: 404 })

    const { error: delErr } = await supabase
      .from('food_vendor_bank_accounts')
      .delete()
      .eq('id', accountId)
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })

    // If the primary account was removed, promote the newest remaining one so
    // the branch still has somewhere for payouts to land.
    let promotedId = null
    if (row.is_current) {
      const { data: rest, error: restErr } = await supabase
        .from('food_vendor_bank_accounts')
        .select('id')
        .eq('branch_id', branchId)
        .eq('cycle_id', cycleId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (!restErr) {
        const next = rest?.[0]?.id
        if (next) {
          const { error: promoteErr } = await supabase
            .from('food_vendor_bank_accounts')
            .update({ is_current: true })
            .eq('id', next)
          if (!promoteErr) promotedId = Number(next)
        }
      }
    }

    return NextResponse.json({ ok: true, deleted_id: accountId, promoted_id: promotedId })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
