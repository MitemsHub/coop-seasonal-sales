// app/api/admin/exhibition/vendors/[id]/route.js
// PATCH — update a vendor (name, phone, address, passcode, status, cycle/branch)
// DELETE — remove a vendor (blocked when products exist — suspend instead)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Invalid vendor' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const supabase = createClient()
    const updates = {}
    if (body.name !== undefined) {
      const name = sanitizeString(body.name || '', { maxLength: 255, encodeHtml: false })
      if (!name) return NextResponse.json({ ok: false, error: 'Vendor name cannot be empty' }, { status: 400 })
      updates.name = name
    }
    if (body.phone !== undefined) updates.phone = sanitizeString(body.phone || '', { maxLength: 30, encodeHtml: false })
    if (body.address !== undefined) updates.address = sanitizeString(body.address || '', { maxLength: 300, encodeHtml: false })
    if (body.passcode !== undefined) {
      const passcode = sanitizeString(body.passcode || '', { maxLength: 50, encodeHtml: false })
      if (!passcode) return NextResponse.json({ ok: false, error: 'Passcode cannot be empty' }, { status: 400 })
      updates.passcode = passcode
    }
    if (body.status !== undefined && ['active', 'suspended'].includes(body.status)) updates.status = body.status
    if (body.cycle_id !== undefined) {
      const cycleId = Math.trunc(Number(body.cycle_id || 0))
      if (cycleId > 0) updates.cycle_id = cycleId
    }
    if (body.branch_id !== undefined) {
      const branchId = Math.trunc(Number(body.branch_id || 0))
      if (branchId > 0) updates.branch_id = branchId
    }

    if (!Object.keys(updates).length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    const { data, error } = await supabase
      .from('exhibition_vendors')
      .update(updates)
      .eq('id', id)
      .select('id, cycle_id, branch_id, name, code, phone, address, status, created_at')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, vendor: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update vendor' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(params?.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Invalid vendor' }, { status: 400 })

    const supabase = createClient()
    const { data: vendor } = await supabase.from('exhibition_vendors').select('id, name').eq('id', id).maybeSingle()
    if (!vendor) return NextResponse.json({ ok: false, error: 'Vendor not found' }, { status: 404 })

    const { data: products } = await supabase.from('exhibition_products').select('id').eq('vendor_id', id).limit(1)
    if (products?.length) {
      return NextResponse.json(
        { ok: false, error: `"${vendor.name}" has products on the catalog. Suspend the account instead of deleting.` },
        { status: 409 }
      )
    }

    const { error } = await supabase.from('exhibition_vendors').delete().eq('id', id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to delete vendor' }, { status: 500 })
  }
}
