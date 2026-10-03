// app/api/food-survey/status/route.js
// Public: is the food item survey open right now, and for which cycle?
// The /survey page and rep portal use this to show the form or a closed
// banner; the write routes enforce the same rule server-side.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getOpenSurveyCycle, surveyClosedMessage } from '@/lib/foodSurveyMutations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createClient()
    const status = await getOpenSurveyCycle(supabase)
    if (status.reason === 'error') {
      return NextResponse.json({ ok: false, error: 'Failed to check survey status' }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      open: status.open,
      reason: status.reason,
      message: status.open ? null : surveyClosedMessage(status),
      cycle: status.cycle
        ? { id: status.cycle.id, code: status.cycle.code || null, name: status.cycle.name, ends_at: status.cycle.ends_at || null }
        : null,
    })
  } catch (e) {
    console.error('Survey status error:', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
