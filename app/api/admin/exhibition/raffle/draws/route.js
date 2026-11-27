// app/api/admin/exhibition/raffle/draws/route.js
// Audit trail for raffle spins.
//   GET  /api/admin/exhibition/raffle/draws?cycle_id=&limit=
//   POST /api/admin/exhibition/raffle/draws
//        { cycle_id, min_amount, finalists: [{ member_id, member_name, amount, orders }],
//          winner_member_id }
//
// The draw happens in the browser (the wheel must land on the winner it picked),
// so this route records what the browser reports rather than choosing a winner.
// It still refuses the shapes that would make the record useless: a winner who
// was not on the wheel, no finalists, or an unknown season.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { validateSession } from '@/lib/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIGRATION_FILE = 'migrations/add-exhibition-raffle-draws.sql'
const MAX_FINALISTS = 100
const MAX_LIMIT = 100

// The table may not exist yet on a deployment that has not run the migration.
// That is a setup state, not a broken page: report it so the desk can say so.
function isMissingTable(error) {
  const code = String(error?.code || '')
  return code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(String(error?.message || ''))
}

function cleanMemberId(v) {
  return String(v ?? '').trim().toUpperCase().slice(0, 40)
}

export async function GET(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const cycleId = Math.trunc(Number(searchParams.get('cycle_id') || 0))
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number(searchParams.get('limit') || 25))))

    const supabase = createClient()
    let query = supabase
      .from('exhibition_raffle_draws')
      .select('*')
      .order('drawn_at', { ascending: false })
      .limit(limit)
    if (cycleId > 0) query = query.eq('cycle_id', cycleId)

    const { data, error } = await query
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ ok: true, draws: [], migration_required: true, migration_file: MIGRATION_FILE })
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, draws: data || [] })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to load draws' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await validateSession(request, 'admin')
  if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const cycleId = Math.trunc(Number(body?.cycle_id || 0))
    const rawMin = Number(body?.min_amount)
    const minAmount = Number.isFinite(rawMin) && rawMin >= 0 ? rawMin : 0
    const winnerId = cleanMemberId(body?.winner_member_id)

    if (!cycleId) return NextResponse.json({ ok: false, error: 'cycle_id is required' }, { status: 400 })
    if (!winnerId) return NextResponse.json({ ok: false, error: 'winner_member_id is required' }, { status: 400 })

    const rawFinalists = Array.isArray(body?.finalists) ? body.finalists : []
    if (!rawFinalists.length) {
      return NextResponse.json({ ok: false, error: 'A draw must record the finalists on the wheel' }, { status: 400 })
    }
    if (rawFinalists.length > MAX_FINALISTS) {
      return NextResponse.json({ ok: false, error: `Too many finalists (max ${MAX_FINALISTS})` }, { status: 400 })
    }

    const finalists = []
    const seen = new Set()
    for (const f of rawFinalists) {
      const memberId = cleanMemberId(f?.member_id)
      if (!memberId || seen.has(memberId)) continue
      seen.add(memberId)
      finalists.push({
        member_id: memberId,
        member_name: String(f?.member_name || '').slice(0, 120),
        amount: Math.max(0, Number(f?.amount) || 0),
        orders: Math.max(0, Math.trunc(Number(f?.orders) || 0)),
      })
    }
    const winner = finalists.find((f) => f.member_id === winnerId)
    if (!winner) {
      return NextResponse.json(
        { ok: false, error: 'The winner must be one of the finalists on the wheel' },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const { data: cycle, error: cycleError } = await supabase
      .from('exhibition_cycles')
      .select('id, name, code')
      .eq('id', cycleId)
      .maybeSingle()
    if (cycleError) return NextResponse.json({ ok: false, error: cycleError.message }, { status: 500 })
    if (!cycle) return NextResponse.json({ ok: false, error: 'Season not found' }, { status: 404 })

    const claims = session.claims || {}
    const drawnBy = String(claims.username || claims.name || claims.sub || claims.member_id || 'admin').slice(0, 120)

    const { data, error } = await supabase
      .from('exhibition_raffle_draws')
      .insert({
        cycle_id: cycleId,
        cycle_name: String(cycle.name || cycle.code || ''),
        min_amount: minAmount,
        finalist_count: finalists.length,
        finalists,
        winner_member_id: winner.member_id,
        winner_name: winner.member_name,
        winner_amount: winner.amount,
        winner_orders: winner.orders,
        drawn_by: drawnBy,
      })
      .select()
      .single()

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Draws are not being saved yet: run ${MIGRATION_FILE} first.`,
            migration_required: true,
            migration_file: MIGRATION_FILE,
          },
          { status: 503 }
        )
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, draw: data })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to record the draw' }, { status: 500 })
  }
}
