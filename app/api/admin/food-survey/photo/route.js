// app/api/admin/food-survey/photo/route.js
// Admin: delete the image from a single survey entry (the entry itself —
// name + price — stays). The freed storage file is removed only if no other
// entry references it.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { removeSurveyPhotos } from '@/lib/foodSurveyPhotos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(req) {
  try {
    const entryId = Number(new URL(req.url).searchParams.get('entry_id'))
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return NextResponse.json({ ok: false, error: 'Missing or invalid entry_id' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: entry, error: fErr } = await supabase
      .from('food_survey_entries')
      .select('id, photo_url')
      .eq('id', entryId)
      .maybeSingle()
    if (fErr) {
      console.error('Admin photo delete lookup error:', fErr)
      return NextResponse.json({ ok: false, error: 'Failed to look up entry' }, { status: 500 })
    }
    if (!entry) return NextResponse.json({ ok: false, error: 'Entry not found' }, { status: 404 })
    if (!entry.photo_url) return NextResponse.json({ ok: true, alreadyEmpty: true })

    const { error } = await supabase
      .from('food_survey_entries')
      .update({ photo_url: null })
      .eq('id', entryId)
    if (error) {
      console.error('Admin photo delete error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to delete image' }, { status: 500 })
    }

    // Remove the file only if nothing else points at it.
    try {
      const { data: others } = await supabase
        .from('food_survey_entries')
        .select('id')
        .eq('photo_url', entry.photo_url)
        .limit(1)
      if (!others?.length) await removeSurveyPhotos(supabase, [entry.photo_url])
    } catch {
      // Best-effort — DB state is already correct.
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Admin photo delete error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
