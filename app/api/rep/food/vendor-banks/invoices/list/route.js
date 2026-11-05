import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { resolveFoodCycleId } from '@/lib/cycleResolve'

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

export async function GET(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module && session.claims.module !== 'food') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const branchId = Number(session?.claims?.branch_id)
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

    const supabase = createClient()
    const cycleId = await resolveActiveCycleId(supabase)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    // ?bank_account_id=<id> narrows the list to one account. Without it every
    // invoice for the branch/cycle is returned, including legacy rows that
    // predate account filing.
    const { searchParams } = new URL(req.url)
    const bankAccountId = Math.trunc(Number(searchParams.get('bank_account_id') || 0))

    let query = supabase
      .from('food_vendor_invoices')
      .select('id,branch_id,cycle_id,bank_account_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)

    if (Number.isFinite(bankAccountId) && bankAccountId > 0) {
      query = query.eq('bank_account_id', bankAccountId)
    }

    const { data: invoices, error } = await query.order('created_at', { ascending: false })
    if (error) {
      if (isMissingTable(error, 'food_vendor_invoices')) return NextResponse.json({ ok: true, invoices: [], cycle_id: cycleId })
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const out = await Promise.all(
      (invoices || []).map(async (inv) => {
        const bucket = String(inv.storage_bucket || '')
        const path = String(inv.storage_path || '')
        let url = null
        if (bucket && path) {
          const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60)
          url = urlData?.signedUrl || null
        }
        return { ...inv, url }
      })
    )

    return NextResponse.json({ ok: true, cycle_id: cycleId, invoices: out })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

