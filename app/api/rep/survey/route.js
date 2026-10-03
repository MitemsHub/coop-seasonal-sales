// app/api/rep/survey/route.js
// Rep-portal view of the food survey, authenticated by the rep_token cookie
// and scoped to the rep's own branch:
//   GET    → submissions for the session branch (so reps edit "their" responses
//            inside the portal without a shared link)
//   PATCH  → edit a submission that belongs to the session branch
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { verify } from '@/lib/signing'
import { sanitizeEntries, replaceEntries, newEditToken, getOpenSurveyCycle, surveyClosedMessage, sanitizePhone, submissionsHasPhone } from '@/lib/foodSurveyMutations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENTRY_SELECT =
  'id, rep_name, branch_id, source, notes, edit_token, created_at, entries:food_survey_entries(id, catalog_id, item_name, category, price, photo_url)'

// phone only exists after migrations/cycle-survey-open.sql — probe once.
const entrySelect = async (supabase) =>
  (await submissionsHasPhone(supabase)) ? ENTRY_SELECT.replace('rep_name,', 'rep_name, phone,') : ENTRY_SELECT

function sessionBranch(req) {
  const token = req.cookies.get('rep_token')?.value
  const claim = token && verify(token)
  if (!claim || claim.role !== 'rep') return { error: 401 }
  if (claim.module && claim.module !== 'food') return { error: 403 }
  const branchId = Math.trunc(Number(claim.branch_id))
  if (!Number.isFinite(branchId) || branchId <= 0) return { error: 403 }
  return { branchId }
}

function sortEntries(sub) {
  return { ...sub, entries: (sub.entries || []).slice().sort((a, b) => (a.id || 0) - (b.id || 0)) }
}

export async function GET(req) {
  try {
    const sess = sessionBranch(req)
    if (sess.error) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: sess.error })

    const supabase = createClient()
    const { data, error } = await supabase
      .from('food_survey_submissions')
      .select(await entrySelect(supabase))
      .eq('branch_id', sess.branchId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      console.error('Rep survey list error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to load submissions' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, submissions: (data || []).map(sortEntries), branch_id: sess.branchId })
  } catch (e) {
    console.error('Rep survey list error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

// POST — create a submission from inside the portal. The branch always comes
// from the session (a rep can never submit for another branch), and the cycle
// is resolved server-side like every other path.
export async function POST(req) {
  try {
    const sess = sessionBranch(req)
    if (sess.error) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: sess.error })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })

    const repName = String(body.rep_name ?? '').trim().slice(0, 100)
    const notes = String(body.notes ?? '').trim().slice(0, 1000)
    if (repName.length < 2) return NextResponse.json({ ok: false, error: 'Please enter your name' }, { status: 400 })
    const { error: phErr, phone } = sanitizePhone(body.phone)
    if (phErr) return NextResponse.json({ ok: false, error: phErr }, { status: 400 })

    const { error: vErr, entries } = sanitizeEntries(body.entries, { requirePhoto: false })
    if (vErr) return NextResponse.json({ ok: false, error: vErr }, { status: 400 })

    const supabase = createClient()

    // Admin-controlled gate: only while a cycle has the survey open.
    const status = await getOpenSurveyCycle(supabase)
    if (status.reason === 'error') {
      return NextResponse.json({ ok: false, error: 'Failed to verify the survey status' }, { status: 500 })
    }
    if (!status.open) {
      return NextResponse.json(
        { ok: false, error: surveyClosedMessage(status), code: 'survey_closed' },
        { status: 403 }
      )
    }
    const cycle = status.cycle
    const editToken = newEditToken()
    const row = {
      rep_name: repName,
      branch_id: sess.branchId,
      cycle_id: cycle?.id ?? null,
      source: 'rep',
      notes,
      edit_token: editToken,
    }
    if (phone && (await submissionsHasPhone(supabase))) row.phone = phone
    const { data: submission, error: sErr } = await supabase
      .from('food_survey_submissions')
      .insert(row)
      .select('id')
      .single()
    if (sErr) {
      console.error('Rep survey insert error:', sErr)
      return NextResponse.json({ ok: false, error: 'Failed to save submission' }, { status: 500 })
    }

    const { error: eErr } = await supabase
      .from('food_survey_entries')
      .insert(entries.map((e) => ({ ...e, submission_id: submission.id })))
    if (eErr) {
      console.error('Rep survey entries insert error:', eErr)
      await supabase.from('food_survey_submissions').delete().eq('id', submission.id)
      return NextResponse.json({ ok: false, error: 'Failed to save your items' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      submission_id: submission.id,
      edit_token: editToken,
      count: entries.length,
      cycle: cycle ? { id: cycle.id, name: cycle.name } : null,
    })
  } catch (e) {
    console.error('Rep survey create error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const sess = sessionBranch(req)
    if (sess.error) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: sess.error })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })

    const submissionId = Number(body.submission_id)
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return NextResponse.json({ ok: false, error: 'Missing submission id' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: existing, error: fErr } = await supabase
      .from('food_survey_submissions')
      .select('id, branch_id')
      .eq('id', submissionId)
      .maybeSingle()
    if (fErr) {
      console.error('Rep survey lookup error:', fErr)
      return NextResponse.json({ ok: false, error: 'Failed to look up submission' }, { status: 500 })
    }
    // Scoped: a rep may only ever touch their own branch's submissions.
    if (!existing || Number(existing.branch_id) !== sess.branchId) {
      return NextResponse.json({ ok: false, error: 'Submission not found for your branch' }, { status: 404 })
    }

    const repName = String(body.rep_name ?? '').trim().slice(0, 100)
    const notes = String(body.notes ?? '').trim().slice(0, 1000)
    const { error: phErr, phone } = sanitizePhone(body.phone)
    if (phErr) return NextResponse.json({ ok: false, error: phErr }, { status: 400 })

    const { error: vErr, entries } = sanitizeEntries(body.entries, { requirePhoto: false })
    if (vErr) return NextResponse.json({ ok: false, error: vErr }, { status: 400 })

    // Closed survey → existing responses are read-only.
    const status = await getOpenSurveyCycle(supabase)
    if (status.reason === 'error') {
      return NextResponse.json({ ok: false, error: 'Failed to verify the survey status' }, { status: 500 })
    }
    if (!status.open) {
      return NextResponse.json(
        { ok: false, error: surveyClosedMessage(status), code: 'survey_closed' },
        { status: 403 }
      )
    }

    const patch = { notes }
    if (repName.length >= 2) patch.rep_name = repName
    if (await submissionsHasPhone(supabase)) patch.phone = phone

    const { error: uErr } = await supabase
      .from('food_survey_submissions')
      .update(patch)
      .eq('id', existing.id)
    if (uErr) {
      console.error('Rep survey update error:', uErr)
      return NextResponse.json({ ok: false, error: 'Failed to save changes' }, { status: 500 })
    }

    const { error: rErr } = await replaceEntries(supabase, existing.id, entries)
    if (rErr) {
      console.error('Rep survey entries error:', rErr)
      return NextResponse.json({ ok: false, error: 'Failed to save your items' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, submission_id: existing.id, count: entries.length })
  } catch (e) {
    console.error('Rep survey edit error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
