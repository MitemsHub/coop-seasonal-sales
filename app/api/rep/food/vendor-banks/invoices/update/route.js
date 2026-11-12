import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { resolveFoodCycleId } from '@/lib/cycleResolve'
import { isFoodBankAccountPaid } from '@/lib/repFoodBankGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

// Cycle resolution is shared with the other invoice routes (lib/cycleResolve).
async function resolveActiveCycleId(supabase) {
  return resolveFoodCycleId(supabase)
}

function cleanText(v, maxLen = 500) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

function cleanDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

function cleanAmount(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return n
}

async function isPaidLocked(supabase, branchId, cycleId) {
  if (!cycleId) return false
  const { data, error } = await supabase
    .from('food_vendor_payment_status')
    .select('is_paid')
    .eq('branch_id', branchId)
    .eq('cycle_id', cycleId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error, 'food_vendor_payment_status')) return false
    throw error
  }
  return !!data?.is_paid
}

export async function POST(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module && session.claims.module !== 'food') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const branchId = Number(session?.claims?.branch_id)
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const invoiceId = Math.trunc(Number(body?.invoice_id || body?.id || 0))
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) return NextResponse.json({ ok: false, error: 'invoice_id required' }, { status: 400 })

    const payload = {}
    if (body?.invoice_ref !== undefined) payload.invoice_ref = cleanText(body.invoice_ref, 120) || null
    if (body?.notes !== undefined) payload.notes = cleanText(body.notes, 1000) || null
    if (body?.invoice_date !== undefined) payload.invoice_date = cleanDate(body.invoice_date)
    if (body?.amount !== undefined) payload.amount = cleanAmount(body.amount)
    if (body?.bank_account_id !== undefined) {
      const raw = Math.trunc(Number(body.bank_account_id || 0))
      payload.bank_account_id = Number.isFinite(raw) && raw > 0 ? raw : null
    }

    if (!Object.keys(payload).length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    const supabase = createClient()
    const cycleId = await resolveActiveCycleId(supabase)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const locked = await isPaidLocked(supabase, branchId, cycleId).catch(() => false)
    if (locked) return NextResponse.json({ ok: false, error: 'Branch is marked as Paid. Editing is locked.' }, { status: 403 })

    const { data: inv, error: selErr } = await supabase
      .from('food_vendor_invoices')
      .select('id,branch_id,cycle_id,bank_account_id,storage_bucket,storage_path')
      .eq('id', invoiceId)
      .maybeSingle()
    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 })
    if (!inv) return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 })
    if (Number(inv.branch_id) !== Number(branchId)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    if (await isFoodBankAccountPaid(supabase, { accountId: inv.bank_account_id, branchId, cycleId })) {
      return NextResponse.json(
        { ok: false, error: 'This invoice is marked as Paid. Editing is locked.' },
        { status: 403 }
      )
    }

    if (payload.bank_account_id) {
      const { data: acct, error: acctErr } = await supabase
        .from('food_vendor_bank_accounts')
        .select('id,is_paid')
        .eq('id', payload.bank_account_id)
        .eq('branch_id', branchId)
        .eq('cycle_id', cycleId)
        .maybeSingle()
      if (acctErr && !isMissingTable(acctErr, 'food_vendor_bank_accounts')) {
        return NextResponse.json({ ok: false, error: acctErr.message }, { status: 500 })
      }
      if (!acct?.id) {
        return NextResponse.json({ ok: false, error: 'That bank account does not belong to this branch' }, { status: 400 })
      }
      if (acct.is_paid) {
        return NextResponse.json(
          { ok: false, error: 'That bank account is marked as Paid. Choose an unpaid account.' },
          { status: 403 }
        )
      }
    }

    const { data: updated, error } = await supabase
      .from('food_vendor_invoices')
      .update(payload)
      .eq('id', invoiceId)
      .select('id,branch_id,cycle_id,bank_account_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const bucket = String(updated?.storage_bucket || '')
    const path = String(updated?.storage_path || '')
    let url = null
    if (bucket && path) {
      const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
      url = urlData?.signedUrl || null
    }

    return NextResponse.json({ ok: true, invoice: { ...updated, url } })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

