import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabaseServer'
import { validateSession, sanitizeString } from '../../../../lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function validateCycleCode(code) {
  const sanitized = sanitizeString(code || '', { maxLength: 50, encodeHtml: false })
  if (!sanitized) return { ok: false, value: '', error: 'Cycle code is required' }
  if (!/^[A-Za-z0-9_-]+$/.test(sanitized)) return { ok: false, value: sanitized, error: 'Cycle code contains invalid characters' }
  return { ok: true, value: sanitized }
}

function validateCycleName(name) {
  const sanitized = sanitizeString(name || '', { maxLength: 255, encodeHtml: false })
  if (!sanitized) return { ok: false, value: '', error: 'Cycle name is required' }
  return { ok: true, value: sanitized }
}

async function getActiveCycleId(supabase) {
  const { data, error } = await supabase
    .from('cycles')
    .select('id')
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.id || null
}

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data: cycles, error } = await supabase
    .from('cycles')
    .select('id, code, name, is_active, starts_at, ends_at, created_at')
    .order('id', { ascending: false })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const active = (cycles || []).find(c => c.is_active)
  return NextResponse.json({ ok: true, cycles: cycles || [], active_cycle_id: active?.id || null })
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const body = await request.json().catch(() => ({}))

  const codeRes = validateCycleCode(body.code)
  const nameRes = validateCycleName(body.name)
  if (!codeRes.ok) return NextResponse.json({ ok: false, error: codeRes.error }, { status: 400 })
  if (!nameRes.ok) return NextResponse.json({ ok: false, error: nameRes.error }, { status: 400 })

  const makeActive = !!body.make_active
  if (makeActive) {
    const { error: offErr } = await supabase.from('cycles').update({ is_active: false }).neq('id', 0)
    if (offErr) return NextResponse.json({ ok: false, error: offErr.message }, { status: 500 })
  }

  const insertPayload = { code: codeRes.value, name: nameRes.value, is_active: makeActive }
  if (body.starts_at) insertPayload.starts_at = body.starts_at
  if (body.ends_at) insertPayload.ends_at = body.ends_at

  const { data, error } = await supabase
    .from('cycles')
    .insert(insertPayload)
    .select('id, code, name, is_active, starts_at, ends_at, created_at')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, cycle: data, active_cycle_id: makeActive ? data?.id : await getActiveCycleId(supabase) })
}

export async function PUT(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const body = await request.json().catch(() => ({}))

  const id = body.id != null ? Number(body.id) : null
  if (!id) return NextResponse.json({ ok: false, error: 'Cycle id is required' }, { status: 400 })

  // Fetch existing cycle
  const { data: existing, error: fetchErr } = await supabase
    .from('cycles')
    .select('id, code, name, is_active, starts_at, ends_at, created_at')
    .eq('id', id)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ ok: false, error: 'Cycle not found' }, { status: 404 })

  // Validate provided fields
  const codeRes = body.code != null ? validateCycleCode(body.code) : null
  const nameRes = body.name != null ? validateCycleName(body.name) : null
  if (codeRes && !codeRes.ok) return NextResponse.json({ ok: false, error: codeRes.error }, { status: 400 })
  if (nameRes && !nameRes.ok) return NextResponse.json({ ok: false, error: nameRes.error }, { status: 400 })

  // If code is changing, check uniqueness
  if (codeRes && codeRes.value !== existing.code) {
    const { data: dup } = await supabase
      .from('cycles')
      .select('id')
      .eq('code', codeRes.value)
      .neq('id', id)
      .maybeSingle()
    if (dup) return NextResponse.json({ ok: false, error: 'A cycle with that code already exists' }, { status: 409 })
  }

  const updates = {}
  if (codeRes) updates.code = codeRes.value
  if (nameRes) updates.name = nameRes.value
  if (body.starts_at !== undefined) updates.starts_at = body.starts_at || null
  if (body.ends_at !== undefined) updates.ends_at = body.ends_at || null

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, cycle: existing, active_cycle_id: existing.is_active ? existing.id : await getActiveCycleId(supabase) })
  }

  const { data, error } = await supabase
    .from('cycles')
    .update(updates)
    .eq('id', id)
    .select('id, code, name, is_active, starts_at, ends_at, created_at')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, cycle: data, active_cycle_id: data.is_active ? data.id : await getActiveCycleId(supabase) })
}

export async function PATCH(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const body = await request.json().catch(() => ({}))

  const id = body.id != null ? Number(body.id) : null
  const codeRes = body.code ? validateCycleCode(body.code) : null
  if (!id && !codeRes) return NextResponse.json({ ok: false, error: 'Cycle id or code is required' }, { status: 400 })
  if (codeRes && !codeRes.ok) return NextResponse.json({ ok: false, error: codeRes.error }, { status: 400 })

  const targetQuery = supabase.from('cycles').select('id').limit(1)
  let targetRes = null
  if (id) targetRes = await targetQuery.eq('id', id).maybeSingle()
  else targetRes = await targetQuery.eq('code', codeRes.value).maybeSingle()
  if (targetRes.error) return NextResponse.json({ ok: false, error: targetRes.error.message }, { status: 500 })
  if (!targetRes.data?.id) return NextResponse.json({ ok: false, error: 'Cycle not found' }, { status: 404 })

  const cycleId = targetRes.data.id
  const { error: offErr } = await supabase.from('cycles').update({ is_active: false }).neq('id', 0)
  if (offErr) return NextResponse.json({ ok: false, error: offErr.message }, { status: 500 })

  const { error: onErr } = await supabase.from('cycles').update({ is_active: true }).eq('id', cycleId)
  if (onErr) return NextResponse.json({ ok: false, error: onErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, active_cycle_id: cycleId })
}
