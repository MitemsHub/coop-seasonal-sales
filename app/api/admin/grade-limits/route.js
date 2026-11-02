// app/api/admin/grade-limits/route.js
// Admin CRUD for the grade_limits table — the per-grade DEFAULT loan limits
// used by the member import when a member's global_limit cell is blank, and
// by eligibility math when a member row carries no override.
//
//   GET   — list grades with their annual and default loan limits
//   PATCH — update either limit: { updates: [{ grade, annual_limit?, global_limit? }] }
//           (whole ₦, 0 or more; 0 means "no limit set for this grade")
//
// Per-member overrides live on members.global_limit and are set from the
// member import template's global_limit column (blank = use the grade default).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const supabase = createClient()
    // Older DBs may be missing annual_limit or category — fall back a column
    // set at a time instead of failing the whole editor.
    const COLUMN_SETS = [
      'grade, global_limit, annual_limit, category, updated_at',
      'grade, global_limit, category, updated_at',
      'grade, global_limit, updated_at',
    ]
    let data = null
    let error = null
    for (const cols of COLUMN_SETS) {
      ;({ data, error } = await supabase
        .from('grade_limits')
        .select(cols)
        .order('grade', { ascending: true }))
      if (!error) break
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, limits: data || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load grade limits' }, { status: 500 })
  }
}

export async function PATCH(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const updates = Array.isArray(body?.updates) ? body.updates : []
    if (!updates.length) {
      return NextResponse.json({ ok: false, error: 'updates array is required' }, { status: 400 })
    }

    // Validate first — one bad row rejects the whole batch, so the table
    // never ends up half-updated. A row may carry the annual limit, the
    // default loan limit, or both.
    const clean = []
    for (const u of updates) {
      const grade = String(u?.grade || '').trim()
      if (!grade) return NextResponse.json({ ok: false, error: 'Every update needs a grade' }, { status: 400 })
      const row = { grade }
      for (const [key, label] of [
        ['annual_limit', 'Annual limit'],
        ['global_limit', 'Default loan limit'],
      ]) {
        if (u?.[key] === undefined || u?.[key] === null || u?.[key] === '') continue
        const n = Number(u[key])
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          return NextResponse.json(
            { ok: false, error: `${label} for "${grade}" must be a whole number of ₦, 0 or more` },
            { status: 400 }
          )
        }
        row[key] = n
      }
      if (Object.keys(row).length === 1) {
        return NextResponse.json(
          { ok: false, error: `Update for "${grade}" needs an annual_limit or global_limit` },
          { status: 400 }
        )
      }
      clean.push(row)
    }

    // Verify every grade actually exists — adding/removing grades stays a
    // managed DB operation, this endpoint only edits existing rows.
    const supabase = createClient()
    const { data: existing, error: listErr } = await supabase.from('grade_limits').select('grade')
    if (listErr) return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 })
    const known = new Set((existing || []).map((r) => String(r.grade).trim().toLowerCase()))
    const unknown = clean.filter((c) => !known.has(c.grade.toLowerCase()))
    if (unknown.length) {
      return NextResponse.json(
        { ok: false, error: `Unknown grade(s): ${unknown.map((c) => c.grade).join(', ')}` },
        { status: 400 }
      )
    }

    const updatedAt = new Date().toISOString()
    for (const row of clean) {
      const { grade, ...values } = row
      const { error: uErr } = await supabase
        .from('grade_limits')
        .update({ ...values, updated_at: updatedAt })
        .eq('grade', grade)
      if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 })
    }

    // The editor is authoritative: a saved default applies to EVERY member
    // of that grade immediately. Member profiles and loan eligibility read
    // members.global_limit, which used to be a snapshot taken at import
    // time — editing a grade never reached those rows, so profiles kept
    // the old limit until the next full member import. Now saving a grade
    // pushes the new limit onto all members carrying that grade.
    const spread = []
    for (const { grade, global_limit } of clean) {
      // Annual limits are per grade, not per member — nothing to spread.
      if (global_limit === undefined) continue
      const { data: spreadRows, error: sErr } = await supabase
        .from('members')
        .update({ global_limit })
        .eq('grade', grade)
        .select('member_id')
      if (sErr) {
        return NextResponse.json(
          { ok: false, error: `Grade "${grade}" saved, but its members did not update: ${sErr.message}` },
          { status: 500 }
        )
      }
      spread.push({ grade, members: (spreadRows || []).length })
    }

    return NextResponse.json({ ok: true, updated: clean.length, spread })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to update grade limits' }, { status: 500 })
  }
}
