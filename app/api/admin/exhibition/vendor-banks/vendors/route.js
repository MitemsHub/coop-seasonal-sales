// app/api/admin/exhibition/vendor-banks/vendors/route.js
// Admin list of exhibition vendors with their bank details.
//   GET /api/admin/exhibition/vendor-banks/vendors?cycle_id=NNN&branch_id=NNN&q=...
// Bank details come from exhibition_vendor_bank_accounts (one current account
// per vendor per cycle). Without a cycle filter the latest account per vendor
// is shown; with one, the account for that specific season.
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

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    const branchId = Math.trunc(Number(searchParams.get('branch_id') || 0))
    const q = String(searchParams.get('q') || '').trim()

    const supabase = createClient()
    let vq = supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id, name, code, phone, address, status, branches:branch_id(name, code), cycles:cycle_id(name, code)')
      .order('name')
    if (branchId > 0) vq = vq.eq('branch_id', branchId)
    if (q) vq = vq.or(`name.ilike.%${q}%,code.ilike.%${q}%,phone.ilike.%${q}%`)
    const { data: vendors, error: vErr } = await vq
    if (vErr) {
      if (isMissingTable(vErr, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet. Run migrations/add-coop-exhibition-module.sql in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: vErr.message }, { status: 500 })
    }

    let bq = supabase
      .from('exhibition_vendor_bank_accounts')
      .select('id, vendor_id, cycle_id, branch_id, bank_name, account_name, account_number, is_current, created_at')
    if (cycleId > 0) bq = bq.eq('cycle_id', cycleId)
    const { data: bankRows, error: bErr } = await bq
    if (bErr && !isMissingTable(bErr, 'exhibition_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    }

    const byVendorCycle = new Map((bankRows || []).map((b) => [`${b.vendor_id}:${b.cycle_id}`, b]))
    const byVendor = new Map()
    for (const b of bankRows || []) {
      const cur = byVendor.get(String(b.vendor_id))
      if (!cur || new Date(b.created_at) > new Date(cur.created_at)) byVendor.set(String(b.vendor_id), b)
    }

    // Invoice counts per vendor (best-effort — the invoices table may not
    // exist yet on fresh databases, so a missing table just yields zeroes).
    const invoiceCounts = new Map()
    const { data: invRows, error: invErr } = await supabase
      .from('exhibition_vendor_invoices')
      .select('vendor_id')
    if (!invErr) {
      for (const r of invRows || []) {
        invoiceCounts.set(String(r.vendor_id), (invoiceCounts.get(String(r.vendor_id)) || 0) + 1)
      }
    }

    const pick = (v) => {
      if (cycleId > 0) return byVendorCycle.get(`${v.id}:${cycleId}`)
      return byVendor.get(String(v.id))
    }

    return NextResponse.json({
      ok: true,
      cycle_id: cycleId > 0 ? cycleId : null,
      vendors: (vendors || []).map((v) => {
        const bank = pick(v)
        return {
          ...v,
          invoice_count: invoiceCounts.get(String(v.id)) || 0,
          branch_name: v.branches?.name || '',
          branch_code: v.branches?.code || '',
          cycle_name: v.cycles?.name || '',
          cycle_code: v.cycles?.code || '',
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
