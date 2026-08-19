// app/api/admin/exhibition/vendors/route.js
// Admin management of exhibition vendors (accounts are admin-created; vendors
// sign in with code + passcode).
//   GET  — list vendors (filter: cycle_id, branch_id, q)
//   POST — create a vendor account
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'

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
    let query = supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id, name, code, passcode, phone, address, status, created_at, branches:branch_id(name, code), cycles:cycle_id(name, code)')
      .order('name')

    if (cycleId > 0) query = query.eq('cycle_id', cycleId)
    if (branchId > 0) query = query.eq('branch_id', branchId)
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%,phone.ilike.%${q}%`)

    const { data, error } = await query
    if (error) {
      if (isMissingTable(error, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet. Run migrations/add-coop-exhibition-module.sql in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      vendors: (data || []).map((v) => ({
        ...v,
        branch_name: v.branches?.name || '',
        branch_code: v.branches?.code || '',
        cycle_name: v.cycles?.name || '',
        cycle_code: v.cycles?.code || '',
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load vendors' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const cycleId = Math.trunc(Number(body.cycle_id || 0))
    const branchId = Math.trunc(Number(body.branch_id || 0))
    if (!Number.isFinite(cycleId) || cycleId <= 0) return NextResponse.json({ ok: false, error: 'Cycle is required' }, { status: 400 })
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Branch is required' }, { status: 400 })

    const name = sanitizeString(body.name || '', { maxLength: 255, encodeHtml: false })
    if (!name) return NextResponse.json({ ok: false, error: 'Vendor name is required' }, { status: 400 })

    const code = sanitizeString(body.code || '', { maxLength: 50, encodeHtml: false }).toUpperCase()
    if (!code) return NextResponse.json({ ok: false, error: 'Vendor code is required' }, { status: 400 })

    const passcode = sanitizeString(body.passcode || '', { maxLength: 50, encodeHtml: false })
    if (!passcode) return NextResponse.json({ ok: false, error: 'Passcode is required' }, { status: 400 })

    const phone = sanitizeString(body.phone || '', { maxLength: 30, encodeHtml: false })
    const address = sanitizeString(body.address || '', { maxLength: 300, encodeHtml: false })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('exhibition_vendors')
      .insert({
        cycle_id: cycleId,
        branch_id: branchId,
        name,
        code,
        passcode,
        phone,
        address,
        status: body.status === 'suspended' ? 'suspended' : 'active',
      })
      .select('id, cycle_id, branch_id, name, code, phone, address, status, created_at')
      .single()

    if (error) {
      if (String(error.code || '') === '23505') {
        return NextResponse.json({ ok: false, error: `Vendor code "${code}" already exists. Use a unique code.` }, { status: 409 })
      }
      if (isMissingTable(error, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet. Run migrations/add-coop-exhibition-module.sql in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, vendor: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to create vendor' }, { status: 500 })
  }
}
