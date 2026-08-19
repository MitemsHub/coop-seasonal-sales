// app/api/admin/exhibition/vendor-banks/set-account/route.js
// Set (or replace) a vendor's bank account for their exhibition cycle.
//   POST { vendor_id, bank_name, account_name, account_number }
// The vendor's cycle/branch drive the row; old accounts for the vendor are
// retired (is_current=false) so one current account exists per vendor.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

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

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const vendorId = Math.trunc(Number(body.vendor_id || 0))
    if (!Number.isFinite(vendorId) || vendorId <= 0) {
      return NextResponse.json({ ok: false, error: 'vendor_id is required' }, { status: 400 })
    }

    const bankName = cleanText(body.bank_name, 120)
    const accountName = cleanText(body.account_name, 120)
    const accountNumber = cleanText(body.account_number, 40)
    if (!bankName || !accountName || !accountNumber) {
      return NextResponse.json({ ok: false, error: 'bank_name, account_name and account_number are required' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: vendor, error: vErr } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id')
      .eq('id', vendorId)
      .maybeSingle()
    if (vErr) {
      if (isMissingTable(vErr, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet. Run migrations/add-coop-exhibition-module.sql in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: vErr.message }, { status: 500 })
    }
    if (!vendor) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 404 })

    const { error: clearErr } = await supabase
      .from('exhibition_vendor_bank_accounts')
      .update({ is_current: false })
      .eq('vendor_id', vendorId)
      .eq('is_current', true)
    if (clearErr && !isMissingTable(clearErr, 'exhibition_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: clearErr.message }, { status: 500 })
    }

    const createdByCode = cleanText(session?.claims?.email || session?.claims?.user || 'admin', 120) || 'admin'
    const { data: bank, error } = await supabase
      .from('exhibition_vendor_bank_accounts')
      .insert({
        vendor_id: vendorId,
        cycle_id: vendor.cycle_id,
        branch_id: vendor.branch_id,
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber,
        is_current: true,
        created_by_role: 'admin',
        created_by_code: createdByCode,
      })
      .select('id, vendor_id, cycle_id, branch_id, bank_name, account_name, account_number, is_current, created_at')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, bank })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to save bank details' }, { status: 500 })
  }
}
