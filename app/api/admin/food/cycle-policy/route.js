import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

function asNonNegInt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.trunc(n))
}

function asNonNegRatePct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n < 0) return null
  return Math.round(n * 100) / 100
}

function asBool(v) {
  if (v === true || v === false) return v
  const s = String(v ?? '').trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  return null
}

async function resolveCycleId(supabase, searchParams) {
  const raw = searchParams?.get?.('cycle_id')
  if (raw != null && raw !== '') {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid cycle_id')
    return Math.trunc(n)
  }
  const { data, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) return null
  return data.id
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const cycleId = await resolveCycleId(supabase, searchParams)
    if (!cycleId) return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })

    const hasLoanRate = await hasColumn(supabase, 'cycles', 'food_loan_interest_rate_pct')
    const hasPolicy = await hasColumn(supabase, 'cycles', 'food_loan_eligible_amount_cap')
    const hasPolicyV2 = await hasColumn(supabase, 'cycles', 'food_loan_eligible_amount_cap_pensioner')
    if (!hasPolicy) {
      return NextResponse.json({
        ok: true,
        cycle_id: cycleId,
        policy: {
          eligible: { pensioner: 0, retiree: 0, active: 0 },
          grace: { pensioner: 0, retiree: 0, active: 0 },
          include_interest_in_cap: true,
          loan_interest_rate_pct: hasLoanRate ? 0 : 13,
        },
      })
    }

    const { data, error } = await supabase
      .from('cycles')
      .select(
        hasPolicyV2
          ? `id,food_loan_eligible_amount_cap,food_loan_grace_amount_cap,food_loan_eligible_amount_cap_pensioner,food_loan_eligible_amount_cap_retiree,food_loan_eligible_amount_cap_active,food_loan_grace_amount_cap_pensioner,food_loan_grace_amount_cap_retiree,food_loan_grace_amount_cap_active,food_loan_cap_include_interest${hasLoanRate ? ',food_loan_interest_rate_pct' : ''}`
          : `id,food_loan_eligible_amount_cap,food_loan_grace_amount_cap${hasLoanRate ? ',food_loan_interest_rate_pct' : ''}`
      )
      .eq('id', cycleId)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data?.id) return NextResponse.json({ ok: false, error: 'Cycle not found' }, { status: 404 })

    const eligibleFallback = Number(data.food_loan_eligible_amount_cap || 0)
    const graceFallback = Number(data.food_loan_grace_amount_cap || 0)
    const ratePct = hasLoanRate ? Number(data.food_loan_interest_rate_pct || 0) : 13

    // RETIREE eligible cap sentinel: a NEGATIVE retiree cap (−1) means
    // "Savings-based (dynamic)" — the retiree's limit is their savings
    // balance minus outstanding loans, with the grace (facility) pool added.
    // There is no fixed admin number in that mode.
    const retireeRaw = hasPolicyV2 ? Number(data.food_loan_eligible_amount_cap_retiree || 0) : eligibleFallback

    return NextResponse.json({
      ok: true,
      cycle_id: data.id,
      policy: {
        eligible: {
          pensioner: hasPolicyV2 ? Number(data.food_loan_eligible_amount_cap_pensioner || 0) : eligibleFallback,
          retiree: retireeRaw,
          retiree_mode: retireeRaw < 0 ? 'savings' : 'fixed',
          active: hasPolicyV2 ? Number(data.food_loan_eligible_amount_cap_active || 0) : eligibleFallback,
        },
        grace: {
          pensioner: hasPolicyV2 ? Number(data.food_loan_grace_amount_cap_pensioner || 0) : graceFallback,
          retiree: hasPolicyV2 ? Number(data.food_loan_grace_amount_cap_retiree || 0) : graceFallback,
          active: hasPolicyV2 ? Number(data.food_loan_grace_amount_cap_active || 0) : graceFallback,
        },
        include_interest_in_cap: hasPolicyV2 ? data.food_loan_cap_include_interest !== false : true,
        loan_interest_rate_pct: Math.max(0, ratePct),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const body = await req.json().catch(() => ({}))

    const cycleId = Number(body?.cycle_id)
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return NextResponse.json({ ok: false, error: 'cycle_id is required' }, { status: 400 })
    }

    const hasLoanRate = await hasColumn(supabase, 'cycles', 'food_loan_interest_rate_pct')
    const hasPolicy = await hasColumn(supabase, 'cycles', 'food_loan_eligible_amount_cap')
    if (!hasPolicy) {
      return NextResponse.json(
        { ok: false, error: 'Cycle policy columns are missing. Run the latest migrations.' },
        { status: 400 }
      )
    }

    const hasPolicyV2 = await hasColumn(supabase, 'cycles', 'food_loan_eligible_amount_cap_pensioner')

    const includeInterest = hasPolicyV2 ? asBool(body?.include_interest_in_cap ?? body?.food_loan_cap_include_interest) : null
    if (hasPolicyV2 && includeInterest == null) {
      return NextResponse.json({ ok: false, error: 'include_interest_in_cap must be true/false' }, { status: 400 })
    }

    const loanRatePct = body?.loan_interest_rate_pct ?? body?.food_loan_interest_rate_pct
    const ratePctParsed = loanRatePct == null ? null : asNonNegRatePct(loanRatePct)
    if (loanRatePct != null && ratePctParsed == null) {
      return NextResponse.json({ ok: false, error: 'loan_interest_rate_pct must be a non-negative number' }, { status: 400 })
    }
    if (loanRatePct != null && !hasLoanRate) {
      return NextResponse.json({ ok: false, error: 'Loan rate column is missing. Run the latest migrations.' }, { status: 400 })
    }

    const eligible = body?.eligible || {}
    const grace = body?.grace || {}
    const eligibleP = asNonNegInt(eligible?.pensioner ?? body?.food_loan_eligible_amount_cap_pensioner)
    // Retiree accepts the "Savings-based (dynamic)" mode: the client sends
    // either the string 'savings'/sentinel −1 (store −1), or a fixed cap ≥ 0.
    const retireeRaw = eligible?.retiree ?? body?.food_loan_eligible_amount_cap_retiree
    const retireeIsSavingsMode = retireeRaw === 'savings' || retireeRaw === 'SAVINGS' || retireeRaw === -1 || (typeof retireeRaw === 'number' && retireeRaw < 0)
    const eligibleR = retireeIsSavingsMode ? -1 : asNonNegInt(retireeRaw)
    const eligibleA = asNonNegInt(eligible?.active ?? body?.food_loan_eligible_amount_cap_active)
    const graceP = asNonNegInt(grace?.pensioner ?? body?.food_loan_grace_amount_cap_pensioner)
    const graceR = asNonNegInt(grace?.retiree ?? body?.food_loan_grace_amount_cap_retiree)
    const graceA = asNonNegInt(grace?.active ?? body?.food_loan_grace_amount_cap_active)

    let eligibleFallback = asNonNegInt(body?.food_loan_eligible_amount_cap)
    let graceFallback = asNonNegInt(body?.food_loan_grace_amount_cap)

    if (hasPolicyV2) {
      if ([eligibleP, eligibleR, eligibleA, graceP, graceR, graceA].some((v) => v == null)) {
        return NextResponse.json({ ok: false, error: 'Caps must be valid non-negative numbers' }, { status: 400 })
      }
    } else {
      if (eligibleFallback == null) {
        const candidates = [eligibleA, eligibleR, eligibleP].filter((v) => v != null)
        if (candidates.length) eligibleFallback = candidates[0]
      }
      if (graceFallback == null) {
        const candidates = [graceA, graceR, graceP].filter((v) => v != null)
        if (candidates.length) graceFallback = candidates[0]
      }
      if (eligibleFallback == null || graceFallback == null) {
        return NextResponse.json({ ok: false, error: 'Caps must be valid non-negative numbers' }, { status: 400 })
      }
    }

    const { data, error } = await supabase
      .from('cycles')
      .update({
        ...(hasLoanRate && ratePctParsed != null ? { food_loan_interest_rate_pct: ratePctParsed } : {}),
        ...(hasPolicyV2
          ? {
              food_loan_eligible_amount_cap_pensioner: eligibleP,
              food_loan_eligible_amount_cap_retiree: eligibleR,
              food_loan_eligible_amount_cap_active: eligibleA,
              food_loan_grace_amount_cap_pensioner: graceP,
              food_loan_grace_amount_cap_retiree: graceR,
              food_loan_grace_amount_cap_active: graceA,
              food_loan_cap_include_interest: includeInterest,
              food_loan_eligible_amount_cap: 0,
              food_loan_grace_amount_cap: 0,
            }
          : {
              food_loan_eligible_amount_cap: eligibleFallback,
              food_loan_grace_amount_cap: graceFallback,
            }),
      })
      .eq('id', cycleId)
      .select(
        hasPolicyV2
          ? `id,food_loan_eligible_amount_cap_pensioner,food_loan_eligible_amount_cap_retiree,food_loan_eligible_amount_cap_active,food_loan_grace_amount_cap_pensioner,food_loan_grace_amount_cap_retiree,food_loan_grace_amount_cap_active,food_loan_cap_include_interest${hasLoanRate ? ',food_loan_interest_rate_pct' : ''}`
          : `id,food_loan_eligible_amount_cap,food_loan_grace_amount_cap${hasLoanRate ? ',food_loan_interest_rate_pct' : ''}`
      )
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data?.id) return NextResponse.json({ ok: false, error: 'Cycle not found' }, { status: 404 })

    const retireeSaved = hasPolicyV2 ? Number(data.food_loan_eligible_amount_cap_retiree || 0) : Number(data.food_loan_eligible_amount_cap || 0)

    return NextResponse.json({
      ok: true,
      cycle_id: data.id,
      policy: {
        eligible: {
          pensioner: hasPolicyV2 ? Number(data.food_loan_eligible_amount_cap_pensioner || 0) : Number(data.food_loan_eligible_amount_cap || 0),
          retiree: retireeSaved,
          retiree_mode: retireeSaved < 0 ? 'savings' : 'fixed',
          active: hasPolicyV2 ? Number(data.food_loan_eligible_amount_cap_active || 0) : Number(data.food_loan_eligible_amount_cap || 0),
        },
        grace: {
          pensioner: hasPolicyV2 ? Number(data.food_loan_grace_amount_cap_pensioner || 0) : Number(data.food_loan_grace_amount_cap || 0),
          retiree: hasPolicyV2 ? Number(data.food_loan_grace_amount_cap_retiree || 0) : Number(data.food_loan_grace_amount_cap || 0),
          active: hasPolicyV2 ? Number(data.food_loan_grace_amount_cap_active || 0) : Number(data.food_loan_grace_amount_cap || 0),
        },
        include_interest_in_cap: hasPolicyV2 ? data.food_loan_cap_include_interest !== false : true,
        loan_interest_rate_pct: hasLoanRate ? Number(data.food_loan_interest_rate_pct || 0) : 13,
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
