import { NextResponse } from 'next/server'
import {
  FOOD_BANK_SELECT,
  cleanText,
  isMissingTable,
  loadRepFoodWriteContext,
  normalizeAccountNumber,
} from '@/lib/repFoodBankGuard'

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
      .select('id,account_number,is_current')
      .eq('id', accountId)
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .maybeSingle()

    if (rowErr && !isMissingTable(rowErr, 'food_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: rowErr.message }, { status: 500 })
    }
    if (!row?.id) return NextResponse.json({ ok: false, error: 'Bank account not found' }, { status: 404 })

    const patch = {}

    if (body.bank_name != null) {
      const bankName = cleanText(body.bank_name, 120)
      if (!bankName) return NextResponse.json({ ok: false, error: 'Bank name is required' }, { status: 400 })
      patch.bank_name = bankName
    }
    if (body.account_name != null) {
      const accountName = cleanText(body.account_name, 120)
      if (!accountName) return NextResponse.json({ ok: false, error: 'Account name is required' }, { status: 400 })
      patch.account_name = accountName
    }
    if (body.account_number != null) {
      const accountNumber = cleanText(body.account_number, 40)
      if (!accountNumber) return NextResponse.json({ ok: false, error: 'Account number is required' }, { status: 400 })
      const next = normalizeAccountNumber(accountNumber)
      if (next !== normalizeAccountNumber(row.account_number)) {
        const { data: others, error: othersErr } = await supabase
          .from('food_vendor_bank_accounts')
          .select('id,account_number')
          .eq('branch_id', branchId)
          .eq('cycle_id', cycleId)
          .neq('id', accountId)
        if (othersErr && !isMissingTable(othersErr, 'food_vendor_bank_accounts')) {
          return NextResponse.json({ ok: false, error: othersErr.message }, { status: 500 })
        }
        if ((others || []).some((r) => normalizeAccountNumber(r.account_number) === next)) {
          return NextResponse.json({ ok: false, error: 'That account number is already attached.' }, { status: 409 })
        }
      }
      patch.account_number = accountNumber
    }

    const wantsPrimary = body.make_current === true || body.make_current === 'true'
    if (!Object.keys(patch).length && !wantsPrimary) {
      return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })
    }

    if (wantsPrimary && !row.is_current) {
      const { error: clearErr } = await supabase
        .from('food_vendor_bank_accounts')
        .update({ is_current: false })
        .eq('branch_id', branchId)
        .eq('cycle_id', cycleId)
        .eq('is_current', true)
      if (clearErr && !isMissingTable(clearErr, 'food_vendor_bank_accounts')) {
        return NextResponse.json({ ok: false, error: clearErr.message }, { status: 500 })
      }
      patch.is_current = true
    }

    const { data: bank, error } = await supabase
      .from('food_vendor_bank_accounts')
      .update(patch)
      .eq('id', accountId)
      .select(FOOD_BANK_SELECT)
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, bank })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
