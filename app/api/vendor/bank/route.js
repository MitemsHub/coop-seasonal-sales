// app/api/vendor/bank/route.js
// The vendor's OWN bank account — where the co-op pays them after a season.
//   GET  — current account (latest across their cycles)
//   POST — set/update their account (one current row per vendor)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

function cleanText(v, maxLen = 120) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

export async function GET(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_vendor_bank_accounts')
      .select('id, vendor_id, cycle_id, branch_id, bank_name, account_name, account_number, is_current, created_at')
      .eq('vendor_id', ctx.vendor_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error && !isMissingTable(error, 'exhibition_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, bank: data || null })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load bank details' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const bankName = cleanText(body.bank_name, 120)
    const accountName = cleanText(body.account_name, 120)
    const accountNumber = cleanText(body.account_number, 40)
    if (!bankName || !accountName || !accountNumber) {
      return NextResponse.json({ ok: false, error: 'bank_name, account_name and account_number are required' }, { status: 400 })
    }

    const supabase = createClient()
    const { error: clearErr } = await supabase
      .from('exhibition_vendor_bank_accounts')
      .update({ is_current: false })
      .eq('vendor_id', ctx.vendor_id)
      .eq('is_current', true)
    if (clearErr && !isMissingTable(clearErr, 'exhibition_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: clearErr.message }, { status: 500 })
    }

    const { data: bank, error } = await supabase
      .from('exhibition_vendor_bank_accounts')
      .insert({
        vendor_id: ctx.vendor_id,
        cycle_id: ctx.cycle_id,
        branch_id: ctx.branch_id,
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber,
        is_current: true,
        created_by_role: 'vendor',
        created_by_code: String(ctx.vendor_code || '').slice(0, 120) || 'vendor',
      })
      .select('id, vendor_id, cycle_id, branch_id, bank_name, account_name, account_number, is_current, created_at')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, bank })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to save bank details' }, { status: 500 })
  }
}
