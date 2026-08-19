// app/api/admin/exhibition/cycles/route.js
// Admin management of exhibition cycles (one season per branch).
//   GET    — list cycles with branch + per-cycle counts
//   POST   — create a cycle
//   PATCH  — activate a cycle (closes other cycles in the same branch)
//   PUT    — update cycle settings (name, dates, status, rates)
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession, sanitizeString, validateNumber } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, table) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return msg.includes(String(table || '').toLowerCase()) && (msg.includes('does not exist') || msg.includes('could not find the table'))
}

// Per-cycle loan caps (Eligible vs Non-Eligible/Grace by member category) —
// mirrors the food cycle's food_loan_* columns. Included on GET and writable
// via PUT so the Exhibition Data page can set them per selected cycle.
const LOAN_LIMIT_COLS = `exh_loan_eligible_amount_cap_pensioner,exh_loan_eligible_amount_cap_retiree,exh_loan_eligible_amount_cap_active,exh_loan_grace_amount_cap_pensioner,exh_loan_grace_amount_cap_retiree,exh_loan_grace_amount_cap_active,exh_loan_cap_include_interest`

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const supabase = createClient()
    const { data: cycles, error } = await supabase
      .from('exhibition_cycles')
      .select(`id, branch_id, name, code, status, starts_at, ends_at, vendor_deduction_rate_pct, loan_interest_rate_pct, created_at, updated_at, ${LOAN_LIMIT_COLS}, branches:branch_id(name, code)`)
      .order('created_at', { ascending: false })
    if (error) {
      if (isMissingTable(error, 'exhibition')) {
        return NextResponse.json({ ok: false, error: 'Coop Exhibition is not set up yet. Run migrations/add-coop-exhibition-module.sql in Supabase.' }, { status: 500 })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // Per-cycle counts (vendors + products + orders)
    const cycleIds = (cycles || []).map((c) => Number(c.id))
    let counts = new Map()
    if (cycleIds.length) {
      const [v, p, o] = await Promise.all([
        supabase.from('exhibition_vendors').select('cycle_id').in('cycle_id', cycleIds),
        supabase.from('exhibition_products').select('cycle_id').in('cycle_id', cycleIds),
        supabase.from('exhibition_orders').select('cycle_id').in('cycle_id', cycleIds),
      ])
      if (!v.error) {
        for (const row of v.data || []) {
          const k = Number(row.cycle_id)
          counts.set(k, { vendors: (counts.get(k)?.vendors || 0) + 1, products: counts.get(k)?.products || 0, orders: counts.get(k)?.orders || 0 })
        }
      }
      if (!p.error) {
        for (const row of p.data || []) {
          const k = Number(row.cycle_id)
          counts.set(k, { vendors: counts.get(k)?.vendors || 0, products: (counts.get(k)?.products || 0) + 1, orders: counts.get(k)?.orders || 0 })
        }
      }
      if (!o.error) {
        for (const row of o.data || []) {
          const k = Number(row.cycle_id)
          counts.set(k, { vendors: counts.get(k)?.vendors || 0, products: counts.get(k)?.products || 0, orders: (counts.get(k)?.orders || 0) + 1 })
        }
      }
    }

    return NextResponse.json({
      ok: true,
      cycles: (cycles || []).map((c) => ({
        ...c,
        branch_name: c.branches?.name || '',
        branch_code: c.branches?.code || '',
        vendors: counts.get(Number(c.id))?.vendors || 0,
        products: counts.get(Number(c.id))?.products || 0,
        orders: counts.get(Number(c.id))?.orders || 0,
      })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load cycles' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const branchId = Math.trunc(Number(body.branch_id || 0))
    if (!Number.isFinite(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Branch is required' }, { status: 400 })

    const name = sanitizeString(body.name || '', { maxLength: 255, encodeHtml: false })
    if (!name) return NextResponse.json({ ok: false, error: 'Cycle name is required' }, { status: 400 })

    const code = sanitizeString(body.code || '', { maxLength: 50, encodeHtml: false })
    if (!code) return NextResponse.json({ ok: false, error: 'Cycle code is required' }, { status: 400 })

    const status = ['draft', 'active', 'closed'].includes(body.status) ? body.status : 'draft'
    const vendorRate = Number(body.vendor_deduction_rate_pct) >= 0 ? Math.round(Number(body.vendor_deduction_rate_pct) * 100) / 100 : 6
    const loanRate = Number(body.loan_interest_rate_pct) >= 0 ? Math.round(Number(body.loan_interest_rate_pct) * 100) / 100 : 13

    const supabase = createClient()
    if (status === 'active') {
      await supabase
        .from('exhibition_cycles')
        .update({ status: 'closed' })
        .eq('branch_id', branchId)
        .neq('status', 'active')
    }

    const { data, error } = await supabase
      .from('exhibition_cycles')
      .insert({
        branch_id: branchId,
        name,
        code,
        status,
        starts_at: body.starts_at || null,
        ends_at: body.ends_at || null,
        vendor_deduction_rate_pct: vendorRate,
        loan_interest_rate_pct: loanRate,
      })
      .select('id, branch_id, name, code, status, starts_at, ends_at, vendor_deduction_rate_pct, loan_interest_rate_pct, created_at')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message || 'Failed to create cycle' }, { status: 500 })

    return NextResponse.json({ ok: true, cycle: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to create cycle' }, { status: 500 })
  }
}

export async function PATCH(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const id = Math.trunc(Number(body.id || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Cycle id required' }, { status: 400 })

    const supabase = createClient()
    const { data: cycle } = await supabase.from('exhibition_cycles').select('id, branch_id, status').eq('id', id).maybeSingle()
    if (!cycle) return NextResponse.json({ ok: false, error: 'Cycle not found' }, { status: 404 })

    const makeActive = body.status === 'active' || body.activate === true
    if (makeActive) {
      await supabase.from('exhibition_cycles').update({ status: 'closed' }).eq('branch_id', cycle.branch_id).neq('id', id).neq('status', 'active')
      const { error: upErr } = await supabase.from('exhibition_cycles').update({ status: 'active' }).eq('id', id)
      if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })
      return NextResponse.json({ ok: true, cycle: { id, status: 'active' } })
    }

    if (body.status === 'draft' || body.status === 'closed') {
      const { error: upErr } = await supabase.from('exhibition_cycles').update({ status: body.status }).eq('id', id)
      if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })
      return NextResponse.json({ ok: true, cycle: { id, status: body.status } })
    }

    return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update cycle' }, { status: 500 })
  }
}

export async function PUT(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const idRes = validateNumber(body.id, { min: 1, integer: true })
    if (!idRes.isValid) return NextResponse.json({ ok: false, error: 'Invalid cycle id' }, { status: 400 })

    const supabase = createClient()
    const { data: current } = await supabase
      .from('exhibition_cycles')
      .select('id, branch_id, status')
      .eq('id', idRes.value)
      .maybeSingle()
    if (!current) return NextResponse.json({ ok: false, error: 'Cycle not found' }, { status: 404 })

    const updates = {}
    // The branch is the delivery location this season serves — editable so the
    // cycle stays tied to the right branch even after creation.
    if (body.branch_id !== undefined) {
      const branchId = Math.trunc(Number(body.branch_id))
      if (!Number.isFinite(branchId) || branchId <= 0) {
        return NextResponse.json({ ok: false, error: 'Branch must be a valid id' }, { status: 400 })
      }
      updates.branch_id = branchId
    }
    if (body.name !== undefined) {
      const name = sanitizeString(body.name || '', { maxLength: 255, encodeHtml: false })
      if (!name) return NextResponse.json({ ok: false, error: 'Cycle name cannot be empty' }, { status: 400 })
      updates.name = name
    }
    if (body.code !== undefined) {
      const code = sanitizeString(body.code || '', { maxLength: 50, encodeHtml: false })
      if (!code) return NextResponse.json({ ok: false, error: 'Cycle code cannot be empty' }, { status: 400 })
      updates.code = code
    }
    if (body.status !== undefined && ['draft', 'active', 'closed'].includes(body.status)) updates.status = body.status
    if (body.starts_at !== undefined) updates.starts_at = body.starts_at || null
    if (body.ends_at !== undefined) updates.ends_at = body.ends_at || null
    if (body.vendor_deduction_rate_pct !== undefined) {
      const v = Math.round(Math.max(0, Number(body.vendor_deduction_rate_pct)) * 100) / 100
      updates.vendor_deduction_rate_pct = v
    }
    if (body.loan_interest_rate_pct !== undefined) {
      const v = Math.round(Math.max(0, Number(body.loan_interest_rate_pct)) * 100) / 100
      updates.loan_interest_rate_pct = v
    }
    // Per-category loan caps (Eligible / Grace) — non-negative integers.
    const loanCapKeys = [
      'exh_loan_eligible_amount_cap_pensioner',
      'exh_loan_eligible_amount_cap_retiree',
      'exh_loan_eligible_amount_cap_active',
      'exh_loan_grace_amount_cap_pensioner',
      'exh_loan_grace_amount_cap_retiree',
      'exh_loan_grace_amount_cap_active',
    ]
    for (const key of loanCapKeys) {
      if (body[key] !== undefined) {
        const n = Math.trunc(Math.max(0, Number(body[key])))
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ ok: false, error: `${key} must be a non-negative number` }, { status: 400 })
        }
        updates[key] = n
      }
    }
    if (body.exh_loan_cap_include_interest !== undefined) {
      updates.exh_loan_cap_include_interest = body.exh_loan_cap_include_interest === true || body.exh_loan_cap_include_interest === 'true'
    }

    if (!Object.keys(updates).length) return NextResponse.json({ ok: false, error: 'Nothing to update' }, { status: 400 })

    // If the branch changes and the season stays active, keep one active cycle
    // per branch — close any other active season in the new branch first.
    if (updates.branch_id && updates.branch_id !== Number(current.branch_id)) {
      const finalStatus = updates.status || current.status
      if (finalStatus === 'active') {
        await supabase
          .from('exhibition_cycles')
          .update({ status: 'closed' })
          .eq('branch_id', updates.branch_id)
          .neq('id', idRes.value)
          .neq('status', 'active')
      }
    }

    const { data, error } = await supabase
      .from('exhibition_cycles')
      .update(updates)
      .eq('id', idRes.value)
      .select('id, branch_id, name, code, status, starts_at, ends_at, vendor_deduction_rate_pct, loan_interest_rate_pct, created_at')
      .single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, cycle: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update cycle' }, { status: 500 })
  }
}

export async function DELETE(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const id = Math.trunc(Number(new URL(request.url).searchParams.get('id') || 0))
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ ok: false, error: 'Cycle id required' }, { status: 400 })

    const supabase = createClient()
    const { data: cycle } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code, status')
      .eq('id', id)
      .maybeSingle()
    if (!cycle) return NextResponse.json({ ok: false, error: 'Cycle not found' }, { status: 404 })

    // Never delete a live season, and never delete one that holds orders — the
    // FK on exhibition_orders is RESTRICT anyway, so this gives a clear message.
    if (cycle.status === 'active') {
      return NextResponse.json({ ok: false, error: 'Close the cycle before deleting it.' }, { status: 400 })
    }
    const { count } = await supabase
      .from('exhibition_orders')
      .select('id', { count: 'exact', head: true })
      .eq('cycle_id', id)
    if (count > 0) {
      return NextResponse.json(
        { ok: false, error: `This cycle has ${count} order${count === 1 ? '' : 's'} — it can't be deleted. Close it instead.` },
        { status: 400 }
      )
    }

    // Cascade removes the season's vendors, categories, products, member
    // prices and payout rows.
    const { error } = await supabase.from('exhibition_cycles').delete().eq('id', id)
    if (error) {
      if (String(error.code) === '23503') {
        return NextResponse.json(
          { ok: false, error: 'This cycle is referenced by orders and can\'t be deleted.' },
          { status: 400 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, deleted_id: id })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to delete cycle' }, { status: 500 })
  }
}
