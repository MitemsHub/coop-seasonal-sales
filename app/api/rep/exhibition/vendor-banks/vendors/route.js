// app/api/rep/exhibition/vendor-banks/vendors/route.js
// Rep-scoped exhibition vendors with bank details — only the vendors whose
// stands belong to the rep's own branch. The latest account per vendor is
// shown (a vendor has one account per exhibition season).
//   GET /api/rep/exhibition/vendor-banks/vendors
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getRepBranch } from '../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

export async function GET(req) {
  try {
    const auth = getRepBranch(req)
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

    const supabase = createClient()
    const { data: vendors, error: vErr } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id, name, code, phone, address, status')
      .eq('branch_id', auth.branchId)
      .order('name')
    if (vErr) {
      if (isMissingTable(vErr, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: vErr.message }, { status: 500 })
    }

    const { data: bankRows, error: bErr } = await supabase
      .from('exhibition_vendor_bank_accounts')
      .select('id, vendor_id, cycle_id, branch_id, bank_name, account_name, account_number, is_current, created_at')
      .eq('branch_id', auth.branchId)
    if (bErr && !isMissingTable(bErr, 'exhibition_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    }

    const byVendor = new Map()
    for (const b of bankRows || []) {
      const cur = byVendor.get(String(b.vendor_id))
      if (!cur || new Date(b.created_at) > new Date(cur.created_at)) byVendor.set(String(b.vendor_id), b)
    }

    return NextResponse.json({
      ok: true,
      branch_id: auth.branchId,
      vendors: (vendors || []).map((v) => {
        const bank = byVendor.get(String(v.id))
        return {
          ...v,
          bank: bank
            ? {
                id: bank.id,
                bank_name: bank.bank_name || '',
                account_name: bank.account_name || '',
                account_number: bank.account_number || '',
                is_current: !!bank.is_current,
                created_at: bank.created_at,
              }
            : null,
        }
      }),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load vendors' }, { status: 500 })
  }
}
