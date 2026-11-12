import { NextResponse } from 'next/server'
import {
  FOOD_BANK_SELECT,
  MAX_FOOD_BANK_ACCOUNTS,
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
    const { supabase, branchId, cycleId, createdByCode } = ctx

    const body = await req.json().catch(() => ({}))
    const bankName = cleanText(body.bank_name, 120)
    const accountName = cleanText(body.account_name, 120)
    const accountNumber = cleanText(body.account_number, 40)

    if (!bankName) return NextResponse.json({ ok: false, error: 'Bank name is required' }, { status: 400 })
    if (!accountName) return NextResponse.json({ ok: false, error: 'Account name is required' }, { status: 400 })
    if (!accountNumber) return NextResponse.json({ ok: false, error: 'Account number is required' }, { status: 400 })

    const { data: existing, error: listErr } = await supabase
      .from('food_vendor_bank_accounts')
      .select('id,account_number,is_current,is_paid')
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)

    if (listErr && !isMissingTable(listErr, 'food_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 })
    }

    const rows = existing || []
    if (rows.length >= MAX_FOOD_BANK_ACCOUNTS) {
      return NextResponse.json(
        {
          ok: false,
          error: `Up to ${MAX_FOOD_BANK_ACCOUNTS} bank accounts can be attached per cycle. Remove one first.`,
        },
        { status: 400 }
      )
    }
    if (rows.length && rows.every((r) => r.is_paid)) {
      return NextResponse.json(
        { ok: false, error: 'All bank accounts are marked as Paid. Editing is locked.' },
        { status: 403 }
      )
    }

    const target = normalizeAccountNumber(accountNumber)
    if (rows.some((r) => normalizeAccountNumber(r.account_number) === target)) {
      return NextResponse.json({ ok: false, error: 'That account number is already attached.' }, { status: 409 })
    }

    // Accounts are independent payment destinations — none is "primary".

    const { data: bank, error } = await supabase
      .from('food_vendor_bank_accounts')
      .insert({
        branch_id: branchId,
        cycle_id: cycleId,
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber,
        is_current: false,
        created_by_role: 'rep',
        created_by_code: createdByCode,
      })
      .select(FOOD_BANK_SELECT)
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, bank })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
