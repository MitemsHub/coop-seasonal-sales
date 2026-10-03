// app/api/food-survey/catalog/route.js
// Public: the surveyable item list (name + category) for the /survey form.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('food_survey_catalog')
      .select('id, name, category, sort_order, active')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      console.error('Food survey catalog error:', error)
      return NextResponse.json({ ok: false, error: 'Failed to load item list' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, items: data || [] })
  } catch (e) {
    console.error('Food survey catalog error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
