import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

async function resolveActiveRamCycleId(supabase) {
  const { data: active, error: aErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (aErr) {
    if (isMissingTable(aErr, 'ram_cycles')) return null
    throw aErr
  }
  if (active?.id) return active.id
  const { data: latest, error: lErr } = await supabase.from('ram_cycles').select('id').order('created_at', { ascending: false }).maybeSingle()
  if (lErr) {
    if (isMissingTable(lErr, 'ram_cycles')) return null
    throw lErr
  }
  return latest?.id || null
}

function isMissingColumn(error, columnName) {
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const c = String(columnName || '').toLowerCase()
  if (!msg.includes(c)) return false
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('could not find'))
}

async function hasColumn(supabase, tableName, columnName) {
  const { error } = await supabase.from(tableName).select(columnName).limit(1)
  if (!error) return true
  if (isMissingTable(error, tableName)) return false
  if (isMissingColumn(error, columnName)) return false
  throw error
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const onlyActive = String(searchParams.get('active') || '1') !== '0'
    const cycleIdParam = asInt(searchParams.get('cycle_id') || searchParams.get('ram_cycle_id'), null)

    const cycleId = Number.isFinite(cycleIdParam) && cycleIdParam != null && cycleIdParam > 0 ? cycleIdParam : await resolveActiveRamCycleId(supabase).catch(() => null)

    let allowedIds = null
    if (cycleId) {
      const { data: links, error: linkErr } = await supabase
        .from('ram_cycle_delivery_locations')
        .select('ram_delivery_location_id,is_active')
        .eq('ram_cycle_id', cycleId)
        .eq('is_active', true)
      if (linkErr) {
        if (!isMissingTable(linkErr, 'ram_cycle_delivery_locations')) return NextResponse.json({ ok: false, error: linkErr.message }, { status: 500 })
      } else {
        allowedIds = new Set((links || []).map((r) => asInt(r?.ram_delivery_location_id, null)).filter((n) => Number.isFinite(n) && n > 0))
      }
    }

    let q = supabase.from('ram_delivery_locations').select('id,delivery_location,name,phone,is_active,rep_code').order('id', { ascending: true })
    if (onlyActive) q = q.eq('is_active', true)
    if (allowedIds) q = q.in('id', Array.from(allowedIds))
    const { data: locations, error: locErr } = await q
    if (locErr) return NextResponse.json({ ok: false, error: locErr.message }, { status: 500 })

    const ids = (locations || []).map((l) => asInt(l?.id, null)).filter((n) => Number.isFinite(n) && n > 0)
    if (!ids.length) return NextResponse.json({ ok: true, locations: [] })

    const bankHasCycle = await hasColumn(supabase, 'ram_vendor_bank_accounts', 'ram_cycle_id').catch(() => false)
    const invoicesHasCycle = await hasColumn(supabase, 'ram_vendor_invoices', 'ram_cycle_id').catch(() => false)

    const [banksRes, invoicesRes, paidRes] = await Promise.all([
      (() => {
        let bq = supabase
          .from('ram_vendor_bank_accounts')
          .select('id,ram_delivery_location_id,ram_cycle_id,bank_name,account_name,account_number,purpose,is_paid,paid_at,is_current,created_at,created_by_role,created_by_code')
          .in('ram_delivery_location_id', ids)
        if (bankHasCycle && cycleId) bq = bq.eq('ram_cycle_id', cycleId)
        return bq
      })(),
      (() => {
        let iq = supabase
          .from('ram_vendor_invoices')
          .select('id,ram_delivery_location_id,ram_cycle_id,bank_account_id,invoice_ref,invoice_date,amount,file_name,mime_type,storage_bucket,storage_path,created_at')
          .in('ram_delivery_location_id', ids)
          .order('created_at', { ascending: false })
        if (invoicesHasCycle && cycleId) iq = iq.eq('ram_cycle_id', cycleId)
        return iq
      })(),
      cycleId
        ? supabase
            .from('ram_vendor_payment_status')
            .select('ram_delivery_location_id,is_paid,paid_at,ram_cycle_id')
            .eq('ram_cycle_id', cycleId)
            .in('ram_delivery_location_id', ids)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (banksRes.error) return NextResponse.json({ ok: false, error: banksRes.error.message }, { status: 500 })
    if (invoicesRes.error) return NextResponse.json({ ok: false, error: invoicesRes.error.message }, { status: 500 })
    if (paidRes?.error) {
      if (!isMissingTable(paidRes.error, 'ram_vendor_payment_status')) {
        return NextResponse.json({ ok: false, error: paidRes.error.message }, { status: 500 })
      }
    }

    // Keep every account per location so admin can see the alternate accounts,
    // not only the one currently used for payouts.
    const banksByLocId = new Map()
    for (const b of banksRes.data || []) {
      const id = Number(b?.ram_delivery_location_id)
      if (!Number.isFinite(id) || id <= 0) continue
      const list = banksByLocId.get(id) || []
      list.push(b)
      banksByLocId.set(id, list)
    }
    for (const list of banksByLocId.values()) {
      list.sort((a, b) => Number(b.is_current) - Number(a.is_current) || new Date(b.created_at) - new Date(a.created_at))
    }
    const invoiceCountByLocId = new Map()
    for (const inv of invoicesRes.data || []) {
      const id = Number(inv?.ram_delivery_location_id)
      if (!Number.isFinite(id) || id <= 0) continue
      invoiceCountByLocId.set(id, (invoiceCountByLocId.get(id) || 0) + 1)
    }

    // Invoices grouped by account, with short-lived links, so the list shows
    // them beside each bank instead of behind an action.
    const invoicesByBankId = new Map()
    await Promise.all(
      (invoicesRes.data || []).map(async (inv) => {
        const bankId = Number(inv?.bank_account_id)
        if (!Number.isFinite(bankId) || bankId <= 0) return
        const bucket = String(inv.storage_bucket || '')
        const path = String(inv.storage_path || '')
        let url = null
        if (bucket && path) {
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
          url = signed?.signedUrl || null
        }
        const list = invoicesByBankId.get(bankId) || []
        list.push({ ...inv, url })
        invoicesByBankId.set(bankId, list)
      })
    )

    const paidByLocId = new Map()
    for (const p of paidRes?.data || []) {
      const id = Number(p?.ram_delivery_location_id)
      if (!Number.isFinite(id) || id <= 0) continue
      paidByLocId.set(id, { is_paid: !!p?.is_paid, paid_at: p?.paid_at || null, ram_cycle_id: p?.ram_cycle_id ?? null })
    }

    const out = (locations || []).map((l) => {
      const id = Number(l.id)
      const banks = (banksByLocId.get(id) || []).map((acct) => ({
        ...acct,
        invoices: invoicesByBankId.get(Number(acct.id)) || [],
      }))
      const bank = banks[0] || null
      const paid = paidByLocId.get(id) || { is_paid: false, paid_at: null, ram_cycle_id: cycleId ?? null }
      return {
        id,
        delivery_location: l.delivery_location || '',
        name: l.name || '',
        phone: l.phone || '',
        rep_code: l.rep_code || '',
        is_active: l.is_active !== false,
        bank,
        banks,
        invoice_count: invoiceCountByLocId.get(id) || 0,
        paid,
      }
    })

    return NextResponse.json({ ok: true, locations: out })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
