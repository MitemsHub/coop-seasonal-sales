import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const MAX_FOOD_BANK_ACCOUNTS = 10

export const FOOD_BANK_SELECT =
  'id,branch_id,cycle_id,bank_name,account_name,account_number,is_current,created_at,created_by_role,created_by_code'

export function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

export function cleanText(v, maxLen = 120) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
}

export function normalizeAccountNumber(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function jsonError(error, status) {
  return NextResponse.json({ ok: false, error }, { status })
}

// Resolves the rep's branch, the active cycle and the paid lock for a write
// request. Returns { response } when the request must be rejected, otherwise
// the context the route needs.
export async function loadRepFoodWriteContext(req) {
  const session = await validateSession(req, 'rep')
  if (!session.valid) return { response: jsonError('Unauthorized', 401) }
  if (session?.claims?.module && session.claims.module !== 'food') {
    return { response: jsonError('Unauthorized', 401) }
  }

  const branchId = Number(session?.claims?.branch_id)
  if (!Number.isFinite(branchId) || branchId <= 0) return { response: jsonError('Forbidden', 403) }

  const supabase = createClient()
  const { data: cycle, error: cycleErr } = await supabase
    .from('cycles')
    .select('id,code,name')
    .eq('is_active', true)
    .maybeSingle()
  if (cycleErr) return { response: jsonError(cycleErr.message, 500) }

  const cycleId = cycle?.id ?? null
  if (!cycleId) return { response: jsonError('No active cycle found', 400) }

  const { data: paidRow, error: paidErr } = await supabase
    .from('food_vendor_payment_status')
    .select('is_paid')
    .eq('branch_id', branchId)
    .eq('cycle_id', cycleId)
    .maybeSingle()
  if (paidErr && !isMissingTable(paidErr, 'food_vendor_payment_status')) {
    return { response: jsonError(paidErr.message, 500) }
  }
  if (paidRow?.is_paid) {
    return { response: jsonError('Branch is marked as Paid. Editing is locked.', 403) }
  }

  const createdByCode =
    cleanText(session?.claims?.branch_code || session?.claims?.rep_code || '', 120) || null

  return { supabase, branchId, cycleId, createdByCode, cycle }
}
