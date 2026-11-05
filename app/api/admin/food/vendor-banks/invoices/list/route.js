import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

async function resolveActiveCycleId(supabase, searchParams) {
  const raw = searchParams.get('cycle_id')
  if (raw != null && raw !== '') {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid cycle_id')
    return Math.trunc(n)
  }
  const { data, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (data?.id) return data.id
    // A closed season must not block this screen: fall back to the newest
    // cycle that actually has orders (lib/orderCycle does the same for lists).
    const { data: latestCycle } = await supabase
      .from('orders')
      .select('cycle_id')
      .not('cycle_id', 'is', null)
      .order('order_id', { ascending: false })
      .limit(1)
      .maybeSingle()
    return latestCycle?.cycle_id ?? null
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const branchId = asInt(searchParams.get('branch_id') || searchParams.get('delivery_branch_id'), 0)
    if (!branchId) return NextResponse.json({ ok: false, error: 'branch_id required' }, { status: 400 })

    const cycleId = await resolveActiveCycleId(supabase, searchParams)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const { data: invoices, error } = await supabase
      .from('food_vendor_invoices')
      .select('id,branch_id,cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at')
      .eq('branch_id', branchId)
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

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

