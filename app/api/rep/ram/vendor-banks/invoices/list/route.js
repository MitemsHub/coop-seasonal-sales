import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { invoiceFileLink } from '@/lib/invoiceStorage'

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

function getRepLocationIds(claims) {
  const rawIds = Array.isArray(claims?.ram_delivery_location_ids) ? claims.ram_delivery_location_ids : []
  const ids = rawIds.length ? rawIds : [claims?.ram_delivery_location_id]
  return ids.map((v) => asInt(v, null)).filter((n) => Number.isFinite(n) && n > 0)
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'rep')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    if (session?.claims?.module !== 'ram') return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const locationId = asInt(searchParams.get('delivery_location_id') || searchParams.get('ram_delivery_location_id'), 0)
    if (!locationId) return NextResponse.json({ ok: false, error: 'delivery_location_id required' }, { status: 400 })

    const allowed = new Set(getRepLocationIds(session.claims))
    if (!allowed.has(locationId)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

    const supabase = createClient()
    const cycleId = await resolveActiveRamCycleId(supabase).catch(() => null)
    let q = supabase
      .from('ram_vendor_invoices')
      .select(
        'id,ram_delivery_location_id,ram_cycle_id,invoice_ref,invoice_date,amount,notes,storage_bucket,storage_path,file_name,mime_type,file_size,created_by_role,created_by_code,created_at'
      )
      .eq('ram_delivery_location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (cycleId) q = q.eq('ram_cycle_id', cycleId)
    const { data: rows, error } = await q

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const signed = (rows || []).map((r) => ({ ...r, url: invoiceFileLink('ram', r) }))

    return NextResponse.json({ ok: true, invoices: signed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
