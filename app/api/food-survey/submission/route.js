// app/api/food-survey/submission/route.js
// Public edit flow for the /survey form (no login):
//   GET    ?rep_name=&branch_id=      → that rep's submissions at that branch
//          ?token=                    → one submission by edit_token
//   PATCH  { token | (submission_id + match rep_name/branch_id), ...updates }
//
// Auth model: the edit_token issued at submit (kept on the rep's device), or
// knowing the rep's name + branch — the same identity the form collects on
// every entry. Admin/rep-portal edits go through their own authenticated
// routes instead.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { sanitizeEntries, replaceEntries, getOpenSurveyCycle, surveyClosedMessage, sanitizePhone, submissionsHasPhone } from '@/lib/foodSurveyMutations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENTRY_SELECT =
  'id, rep_name, branch_id, source, notes, edit_token, created_at, entries:food_survey_entries(id, catalog_id, item_name, category, price, photo_url)'

// phone only exists after migrations/cycle-survey-open.sql — probe once.
const entrySelect = async (supabase) =>
  (await submissionsHasPhone(supabase)) ? ENTRY_SELECT.replace('rep_name,', 'rep_name, phone,') : ENTRY_SELECT

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

function sortEntries(sub) {
  return { ...sub, entries: (sub.entries || []).slice().sort((a, b) => (a.id || 0) - (b.id || 0)) }
}

export async function GET(req) {
  try {
    const url = new URL(req.url)
    const token = clean(url.searchParams.get('token'), 100)
    const repName = clean(url.searchParams.get('rep_name'), 100)
    const branchId = Number(url.searchParams.get('branch_id'))

    const supabase = createClient()
    const select = await entrySelect(supabase)

    if (token) {
      const { data, error } = await supabase
        .from('food_survey_submissions')
        .select(select)
        .eq('edit_token', token)
        .maybeSingle()
      if (error) {
        console.error('Food survey lookup error:', error)
        return NextResponse.json({ ok: false, error: 'Failed to look up submission' }, { status: 500 })
      }
      if (!data) return NextResponse.json({ ok: false, error: 'No submission found for this link' }, { status: 404 })
      return NextResponse.json({ ok: true, submissions: [sortEntries(data)] })
    }

    if (repName.length < 2 || !Number.isInteger(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'Enter your name and branch to find your response' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('food_survey_submissions')
      .select(select)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      console.error('Food survey lookup error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to look up submissions' }, { status: 500 })
    }

    // Name match is case/whitespace-insensitive — reps type it by hand.
    const needle = repName.toLowerCase()
    const matches = (data || [])
      .filter((s) => String(s.rep_name || '').trim().toLowerCase() === needle)
      .map(sortEntries)

    return NextResponse.json({ ok: true, submissions: matches })
  } catch (e) {
    console.error('Food survey lookup error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })

    const supabase = createClient()

    const token = clean(body.token, 100)
    const submissionId = Number(body.submission_id)
    const matchName = clean(body.match_rep_name, 100)
    const matchBranchId = Number(body.match_branch_id)

    // Locate the submission: by token, or by id + name/branch identity.
    let query = supabase
      .from('food_survey_submissions')
      .select('id, rep_name, branch_id, edit_token')
      .limit(1)
    if (token) {
      query = query.eq('edit_token', token)
    } else if (Number.isInteger(submissionId) && submissionId > 0) {
      query = query
        .eq('id', submissionId)
        .eq('branch_id', matchBranchId)
    } else {
      return NextResponse.json({ ok: false, error: 'Missing submission reference' }, { status: 400 })
    }

    const { data: existing, error: fErr } = await query.maybeSingle()
    if (fErr) {
      console.error('Food survey edit lookup error:', fErr)
      return NextResponse.json({ ok: false, error: 'Failed to look up submission' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Submission not found — check your name and branch' }, { status: 404 })
    }
    // Id path also proves name ownership (branch already matched above).
    if (!token) {
      const sameName = String(existing.rep_name || '').trim().toLowerCase() === matchName.toLowerCase()
      if (!sameName) {
        return NextResponse.json({ ok: false, error: 'That response belongs to a different name' }, { status: 403 })
      }
    }

    // Admin-controlled gate: once the admin closes the survey (or its end
    // date passes), existing responses become uneditable too.
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

    const repName = clean(body.rep_name, 100)
    const branchId = Number(body.branch_id)
    const notes = clean(body.notes, 1000)
    const { error: phErr, phone } = sanitizePhone(body.phone)
    if (phErr) return NextResponse.json({ ok: false, error: phErr }, { status: 400 })

    if (repName.length < 2) {
      return NextResponse.json({ ok: false, error: 'Please enter your name' }, { status: 400 })
    }
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'Please choose your branch' }, { status: 400 })
    }

    // Edits keep photos optional per entry — an entry whose image the admin
    // removed shouldn't block unrelated edits.
    const { error: vErr, entries } = sanitizeEntries(body.entries, { requirePhoto: false })
    if (vErr) return NextResponse.json({ ok: false, error: vErr }, { status: 400 })

    const patch = { rep_name: repName, branch_id: branchId, notes }
    if (await submissionsHasPhone(supabase)) patch.phone = phone
    const { error: uErr } = await supabase
      .from('food_survey_submissions')
      .update(patch)
      .eq('id', existing.id)
    if (uErr) {
      console.error('Food survey edit update error:', uErr)
      return NextResponse.json({ ok: false, error: 'Failed to save changes' }, { status: 500 })
    }

    const { error: rErr } = await replaceEntries(supabase, existing.id, entries)
    if (rErr) {
      console.error('Food survey edit entries error:', rErr)
      return NextResponse.json({ ok: false, error: 'Failed to save your items' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, submission_id: existing.id, count: entries.length })
  } catch (e) {
    console.error('Food survey edit error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
