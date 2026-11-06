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
      .select('id, vendor_id, cycle_id, branch_id, bank_name, account_name, account_number, purpose, is_paid, paid_at, is_current, created_at')
    if (cycleId > 0) bq = bq.eq('cycle_id', cycleId)
    const { data: bankRows, error: bErr } = await bq
    if (bErr && !isMissingTable(bErr, 'exhibition_vendor_bank_accounts')) {
      return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 })
    }

    // Group every account per vendor, so the admin screen can show the
    // alternates too. Without a cycle filter, only the newest season's accounts
    // are listed — older seasons stay in the table for the record.
    const banksByVendor = new Map()
    for (const b of bankRows || []) {
      const key = String(b.vendor_id)
      const list = banksByVendor.get(key) || []
      list.push(b)
      banksByVendor.set(key, list)
    }
    const banksForVendor = (vendorId) => {
      let list = banksByVendor.get(String(vendorId)) || []
      if (cycleId <= 0 && list.length) {
        const newestCycle = list.reduce((acc, b) => (new Date(b.created_at) > new Date(acc.created_at) ? b : acc), list[0])?.cycle_id
        list = list.filter((b) => String(b.cycle_id) === String(newestCycle))
      }
      return list.sort((a, b) => Number(b.is_current) - Number(a.is_current) || new Date(b.created_at) - new Date(a.created_at))
    }

    // Invoice counts per vendor (best-effort — the invoices table may not
    // exist yet on fresh databases, so a missing table just yields zeroes).
    const invoiceCounts = new Map()
    const invoicesByBankId = new Map()
    const { data: invRows, error: invErr } = await supabase
      .from('exhibition_vendor_invoices')
      .select('id,vendor_id,cycle_id,bank_account_id,invoice_ref,invoice_date,amount,file_name,mime_type,storage_bucket,storage_path,created_at')
      .order('created_at', { ascending: false })
    if (!invErr) {
      await Promise.all(
        (invRows || []).map(async (r) => {
          invoiceCounts.set(String(r.vendor_id), (invoiceCounts.get(String(r.vendor_id)) || 0) + 1)
          const bankId = Number(r.bank_account_id)
          if (!Number.isFinite(bankId) || bankId <= 0) return
          const bucket = String(r.storage_bucket || '')
          const path = String(r.storage_path || '')
          let url = null
          if (bucket && path) {
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
            url = signed?.signedUrl || null
          }
          const list = invoicesByBankId.get(bankId) || []
          list.push({ ...r, url })
          invoicesByBankId.set(bankId, list)
        })
      )
    }

    const pick = (v) => {
      const list = banksForVendor(v.id)
      return list.find((b) => b.is_current) || list[0] || null
    }

    return NextResponse.json({
      ok: true,
      cycle_id: cycleId > 0 ? cycleId : null,
      vendors: (vendors || []).map((v) => {
        const bank = pick(v)
        const banks = banksForVendor(v.id).map((acct) => ({
          ...acct,
          invoices: invoicesByBankId.get(Number(acct.id)) || [],
        }))
        return {
          ...v,
          invoice_count: invoiceCounts.get(String(v.id)) || 0,
          banks,
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
