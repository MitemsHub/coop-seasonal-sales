// app/api/food-survey/submit/route.js
// Public: final submission for the /survey form.
// Photos are already uploaded individually (see ../photo); this persists the
// submission + its line items as JSON. Validates everything server-side —
// anonymous endpoint, so it must never trust the client.
// Returns an edit_token so the rep can re-open their own response later
// (kept on their device) without needing an account.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { sanitizeEntries, newEditToken, getOpenSurveyCycle, surveyClosedMessage, sanitizePhone, submissionsHasPhone } from '@/lib/foodSurveyMutations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })

    const repName = clean(body.rep_name, 100)
    const branchId = Number(body.branch_id)
    const source = body.source === 'admin' ? 'admin' : 'rep'
    const notes = clean(body.notes, 1000)
    const { error: phErr, phone } = sanitizePhone(body.phone)
    if (phErr) return NextResponse.json({ ok: false, error: phErr }, { status: 400 })

    if (repName.length < 2) {
      return NextResponse.json({ ok: false, error: 'Please enter your name' }, { status: 400 })
    }
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return NextResponse.json({ ok: false, error: 'Please choose your branch' }, { status: 400 })
    }

    const { error: vErr, entries } = sanitizeEntries(body.entries, { requirePhoto: true })
    if (vErr) return NextResponse.json({ ok: false, error: vErr }, { status: 400 })

    const supabase = createClient()

    // Branch must exist
    const { data: branch, error: bErr } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .maybeSingle()
    if (bErr) {
      console.error('Food survey branch lookup error:', bErr)
      return NextResponse.json({ ok: false, error: 'Failed to validate branch' }, { status: 500 })
    }
    if (!branch) {
      return NextResponse.json({ ok: false, error: 'Unknown branch selected' }, { status: 400 })
    }

    // Admin-controlled gate: the survey only accepts new responses while a
    // cycle has the survey open (and its end date hasn't passed).
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

    const editToken = newEditToken()
    // Tag the submission with the cycle whose survey is open — this is the
    // linkage between a response and its food cycle.
    const cycle = status.cycle
    const row = { rep_name: repName, branch_id: branchId, source, notes, edit_token: editToken, cycle_id: cycle?.id ?? null }
    if (phone && (await submissionsHasPhone(supabase))) row.phone = phone
    const { data: submission, error: sErr } = await supabase
      .from('food_survey_submissions')
      .insert(row)
      .select('id')
      .single()
    if (sErr) {
      console.error('Food survey submission insert error:', sErr)
      return NextResponse.json({ ok: false, error: 'Failed to save your submission' }, { status: 500 })
    }

    const rows = entries.map((e) => ({ ...e, submission_id: submission.id }))
    const { error: eErr } = await supabase.from('food_survey_entries').insert(rows)
    if (eErr) {
      console.error('Food survey entries insert error:', eErr)
      // Roll back the now-empty submission so we don't show ghost rows.
      await supabase.from('food_survey_submissions').delete().eq('id', submission.id)
      return NextResponse.json({ ok: false, error: 'Failed to save your items' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, submission_id: submission.id, edit_token: editToken, count: rows.length, cycle: cycle ? { id: cycle.id, name: cycle.name } : null })
  } catch (e) {
    console.error('Food survey submit error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
