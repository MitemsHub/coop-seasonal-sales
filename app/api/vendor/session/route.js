import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { sign, verify } from '@/lib/signingEdge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const token = req.cookies.get('vendor_token')?.value
    if (!token) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
    const claim = await verify(token)
    if (!claim || claim.role !== 'vendor') {
      return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 })
    }

    const supabase = createClient()
    const { data: vendor } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id, name, code, phone, address, status, branches:branch_id(name, code)')
      .eq('id', claim.vendor_id)
      .maybeSingle()
    if (!vendor) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 401 })

    const { data: cycle } = await supabase
      .from('exhibition_cycles')
      .select('id, name, status, starts_at, ends_at')
      .eq('id', vendor.cycle_id)
      .maybeSingle()

    return NextResponse.json({
      ok: true,
      vendor: {
        id: Number(vendor.id),
        name: vendor.name || '',
        code: vendor.code || '',
        phone: vendor.phone || '',
        address: vendor.address || '',
        cycle_id: Number(vendor.cycle_id),
        branch: vendor.branches?.name || '',
        branch_code: vendor.branches?.code || '',
      },
      cycle: cycle
        ? {
            id: Number(cycle.id),
            name: cycle.name || '',
            status: cycle.status || 'draft',
            starts_at: cycle.starts_at,
            ends_at: cycle.ends_at,
          }
        : null,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Session error' }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('vendor_token', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}

export async function POST(req) {
  try {
    const supabase = createClient()
    const body = await req.json().catch(() => ({}))
    const code = String(body?.code || '').trim().toUpperCase()
    const passcode = String(body?.passcode || '').trim()
    if (!code || !passcode) {
      return NextResponse.json({ ok: false, error: 'Vendor code and passcode are required' }, { status: 400 })
    }

    const { data: vendor, error } = await supabase
      .from('exhibition_vendors')
      .select('id, cycle_id, branch_id, name, code, passcode, phone, status, branches:branch_id(name, code)')
      .eq('code', code)
      .maybeSingle()

    if (error) {
      if (String(error?.code || '') === '42P01') {
        return NextResponse.json(
          { ok: false, error: 'Coop Exhibition is not set up yet. Run the exhibition migration in Supabase.' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message || 'Invalid credentials' }, { status: 500 })
    }

    if (!vendor) return NextResponse.json({ ok: false, error: 'Invalid vendor code' }, { status: 401 })
    if (String(vendor.passcode || '') !== passcode) {
      return NextResponse.json({ ok: false, error: 'Invalid passcode' }, { status: 401 })
    }
    if (vendor.status !== 'active') {
      return NextResponse.json({ ok: false, error: 'This vendor account is not active. Contact your administrator.' }, { status: 403 })
    }

    // Resolve the vendor's cycle for context (name/status surfaced in the portal).
    const { data: cycle, error: cycleErr } = await supabase
      .from('exhibition_cycles')
      .select('id, name, status, branch_id')
      .eq('id', vendor.cycle_id)
      .maybeSingle()
    if (cycleErr && String(cycleErr?.code || '') !== '42P01') {
      return NextResponse.json({ ok: false, error: cycleErr.message }, { status: 500 })
    }

    const token = await sign(
      {
        role: 'vendor',
        vendor_id: Number(vendor.id),
        vendor_code: code,
        cycle_id: Number(vendor.cycle_id),
        branch_id: Number(vendor.branch_id),
      },
      60 * 60 * 8 // 8h
    )

    const res = NextResponse.json({
      ok: true,
      vendor: {
        id: Number(vendor.id),
        name: vendor.name || '',
        code,
        phone: vendor.phone || '',
        cycle_id: Number(vendor.cycle_id),
        branch: vendor.branches?.name || '',
        branch_code: vendor.branches?.code || '',
      },
      cycle: cycle
        ? { id: Number(cycle.id), name: cycle.name || '', status: cycle.status || 'draft' }
        : null,
    })
    res.cookies.set('vendor_token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8 })
    return res
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Login failed' }, { status: 500 })
  }
}
