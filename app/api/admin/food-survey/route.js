// app/api/admin/food-survey/route.js
// Admin: full CRUD over food-survey submissions.
//   GET    ?cycle_id=   → list (with entries, branch, cycle); optional filter
//   POST               → create a submission (admin uploading on a rep's behalf)
//   PATCH               → edit rep name / branch / cycle / notes + replace entries
//   DELETE ?id=         → delete a submission (entries cascade, photos cleaned)
// Middleware already enforces the admin session for /api/admin/*.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { sanitizeEntries, replaceEntries, resolveActiveCycle, sanitizePhone, submissionsHasPhone } from '@/lib/foodSurveyMutations'
import { removeSurveyPhotos } from '@/lib/foodSurveyPhotos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENTRY_SELECT =
  'id, rep_name, branch_id, cycle_id, source, notes, edit_token, created_at, ' +
  'branch:branch_id(id, code, name), cycle:cycle_id(id, name), ' +
  'entries:food_survey_entries(id, catalog_id, item_name, category, price, photo_url, created_at)'

// phone only exists after migrations/cycle-survey-open.sql — probe once.
const entrySelect = async (supabase) =>
  (await submissionsHasPhone(supabase)) ? ENTRY_SELECT.replace('rep_name,', 'rep_name, phone,') : ENTRY_SELECT

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

function sortEntries(sub) {
  return { ...sub, entries: (sub.entries || []).slice().sort((a, b) => (a.id || 0) - (b.id || 0)) }
}

async function validateBranch(supabase, branchId) {
  const { data, error } = await supabase.from('branches').select('id').eq('id', branchId).maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

async function validateCycle(supabase, cycleId) {
  if (cycleId == null) return true
  const { data, error } = await supabase.from('cycles').select('id').eq('id', cycleId).maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

export async function GET(req) {
  try {
    const cycleFilter = Number(new URL(req.url).searchParams.get('cycle_id'))
    const supabase = createClient()

    let query = supabase
      .from('food_survey_submissions')
      .select(await entrySelect(supabase))
      .order('created_at', { ascending: false })
      .limit(500)
    if (Number.isInteger(cycleFilter) && cycleFilter > 0) query = query.eq('cycle_id', cycleFilter)

    const { data, error } = await query
    if (error) {
      console.error('Admin food survey list error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to load submissions' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, submissions: (data || []).map(sortEntries) })
  } catch (e) {
    console.error('Admin food survey list error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

// POST — admin creates a submission directly (same shape the form posts).
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })

    const repName = clean(body.rep_name, 100)
    const branchId = Number(body.branch_id)
    const notes = clean(body.notes, 1000)
    const cycleId = body.cycle_id == null || body.cycle_id === '' ? null : Number(body.cycle_id)
    const { error: phErr, phone } = sanitizePhone(body.phone)
    if (phErr) return NextResponse.json({ ok: false, error: phErr }, { status: 400 })

    if (repName.length < 2) return NextResponse.json({ ok: false, error: 'Please enter a name' }, { status: 400 })
    if (!Number.isInteger(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Please choose a branch' }, { status: 400 })
    if (cycleId != null && !Number.isInteger(cycleId)) return NextResponse.json({ ok: false, error: 'Invalid cycle' }, { status: 400 })

    const { error: vErr, entries } = sanitizeEntries(body.entries, { requirePhoto: false })
    if (vErr) return NextResponse.json({ ok: false, error: vErr }, { status: 400 })

    const supabase = createClient()
    try {
      if (!(await validateBranch(supabase, branchId))) {
        return NextResponse.json({ ok: false, error: 'Unknown branch selected' }, { status: 400 })
      }
      if (!(await validateCycle(supabase, cycleId))) {
        return NextResponse.json({ ok: false, error: 'Unknown cycle selected' }, { status: 400 })
      }
    } catch (e) {
      console.error('Admin food survey validation error:', e)
      return NextResponse.json({ ok: false, error: 'Failed to validate submission' }, { status: 500 })
    }

    // No cycle chosen → tag with the active/most-recent one, like rep submits.
    let resolvedCycleId = cycleId
    if (resolvedCycleId == null) {
      const cycle = await resolveActiveCycle(supabase)
      resolvedCycleId = cycle?.id ?? null
    }

    const row = { rep_name: repName, branch_id: branchId, cycle_id: resolvedCycleId, source: 'admin', notes }
    if (phone && (await submissionsHasPhone(supabase))) row.phone = phone
    const { data: submission, error: sErr } = await supabase
      .from('food_survey_submissions')
      .insert(row)
      .select('id')
      .single()
    if (sErr) {
      console.error('Admin food survey insert error:', sErr)
      return NextResponse.json({ ok: false, error: 'Failed to save submission' }, { status: 500 })
    }

    const { error: eErr } = await supabase
      .from('food_survey_entries')
      .insert(entries.map((e) => ({ ...e, submission_id: submission.id })))
    if (eErr) {
      console.error('Admin food survey entries insert error:', eErr)
      await supabase.from('food_survey_submissions').delete().eq('id', submission.id)
      return NextResponse.json({ ok: false, error: 'Failed to save items' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, submission_id: submission.id, count: entries.length })
  } catch (e) {
    console.error('Admin food survey create error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — admin edits a submission: identity fields + full entry replacement.
export async function PATCH(req) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })

    const submissionId = Number(body.submission_id)
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return NextResponse.json({ ok: false, error: 'Missing submission id' }, { status: 400 })
    }

    const repName = clean(body.rep_name, 100)
    const branchId = Number(body.branch_id)
    const notes = clean(body.notes, 1000)
    const { error: phErr, phone } = sanitizePhone(body.phone)
    if (phErr) return NextResponse.json({ ok: false, error: phErr }, { status: 400 })
    // cycle_id: undefined → leave untouched; '' / null → clear; number → set.
    const cycleTouched = Object.prototype.hasOwnProperty.call(body, 'cycle_id')
    const cycleId = !cycleTouched || body.cycle_id == null || body.cycle_id === '' ? null : Number(body.cycle_id)
    const replaceItems = Array.isArray(body.entries)

    if (repName.length < 2) return NextResponse.json({ ok: false, error: 'Please enter a name' }, { status: 400 })
    if (!Number.isInteger(branchId) || branchId <= 0) return NextResponse.json({ ok: false, error: 'Please choose a branch' }, { status: 400 })
    if (cycleTouched && cycleId != null && !Number.isInteger(cycleId)) return NextResponse.json({ ok: false, error: 'Invalid cycle' }, { status: 400 })

    let entries = null
    if (replaceItems) {
      const { error: vErr, entries: cleanEntries } = sanitizeEntries(body.entries, { requirePhoto: false })
      if (vErr) return NextResponse.json({ ok: false, error: vErr }, { status: 400 })
      entries = cleanEntries
    }

    const supabase = createClient()
    const { data: existing, error: fErr } = await supabase
      .from('food_survey_submissions')
      .select('id')
      .eq('id', submissionId)
      .maybeSingle()
    if (fErr) {
      console.error('Admin food survey lookup error:', fErr)
      return NextResponse.json({ ok: false, error: 'Failed to look up submission' }, { status: 500 })
    }
    if (!existing) return NextResponse.json({ ok: false, error: 'Submission not found' }, { status: 404 })

    try {
      if (!(await validateBranch(supabase, branchId))) {
        return NextResponse.json({ ok: false, error: 'Unknown branch selected' }, { status: 400 })
      }
      if (cycleTouched && !(await validateCycle(supabase, cycleId))) {
        return NextResponse.json({ ok: false, error: 'Unknown cycle selected' }, { status: 400 })
      }
    } catch (e) {
      console.error('Admin food survey validation error:', e)
      return NextResponse.json({ ok: false, error: 'Failed to validate submission' }, { status: 500 })
    }

    const update = { rep_name: repName, branch_id: branchId, notes }
    if (cycleTouched) update.cycle_id = cycleId
    if (await submissionsHasPhone(supabase)) update.phone = phone
    const { error: uErr } = await supabase
      .from('food_survey_submissions')
      .update(update)
      .eq('id', submissionId)
    if (uErr) {
      console.error('Admin food survey update error:', uErr)
      return NextResponse.json({ ok: false, error: 'Failed to save changes' }, { status: 500 })
    }

    if (entries) {
      const { error: rErr } = await replaceEntries(supabase, submissionId, entries)
      if (rErr) {
        console.error('Admin food survey entries error:', rErr)
        return NextResponse.json({ ok: false, error: 'Failed to save items' }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, submission_id: submissionId, count: entries ? entries.length : undefined })
  } catch (e) {
    console.error('Admin food survey edit error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE ?id= — remove a submission; orphaned photos are cleaned up.
export async function DELETE(req) {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid id' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: photos, error: pErr } = await supabase
      .from('food_survey_entries')
      .select('photo_url')
      .eq('submission_id', id)
      .not('photo_url', 'is', null)
    if (pErr) {
      console.error('Admin food survey photo scan error:', pErr)
      return NextResponse.json({ ok: false, error: 'Failed to load submission' }, { status: 500 })
    }

    const { error } = await supabase.from('food_survey_submissions').delete().eq('id', id)
    if (error) {
      console.error('Admin food survey delete error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to delete submission' }, { status: 500 })
    }

    // Entries cascade-deleted → any photo not referenced elsewhere is orphaned.
    const urls = (photos || []).map((r) => r.photo_url).filter(Boolean)
    if (urls.length) {
      try {
        const { data: stillUsed } = await supabase
          .from('food_survey_entries')
          .select('photo_url')
          .in('photo_url', urls)
        const used = new Set((stillUsed || []).map((r) => r.photo_url))
        const orphans = urls.filter((u) => !used.has(u))
        if (orphans.length) await removeSurveyPhotos(supabase, orphans)
      } catch {
        // Best-effort cleanup only.
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Admin food survey delete error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
