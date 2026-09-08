import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import { queryDirect } from '@/lib/directDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isMissingTable(error, tableName) {
  const code = String(error?.code || '')
  if (code === '42P01') return true
  const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  const t = String(tableName || '').toLowerCase()
  if (!msg.includes(t)) return false
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

async function resolveRamCycleId({ supabase, cycleParam, ordersHasCycle }) {
  if (!ordersHasCycle) return { cycleId: null, activeCycleId: null }
  const raw = String(cycleParam ?? '').trim()
  if (raw.toLowerCase() === 'all') return { cycleId: null, activeCycleId: null }

  if (raw) {
    if (/^\d+$/.test(raw)) return { cycleId: Math.trunc(Number(raw)), activeCycleId: null }
    return { cycleId: raw, activeCycleId: null }
  }

  const { data: active, error: aErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (aErr) {
    if (!isMissingTable(aErr, 'ram_cycles')) throw aErr
    return { cycleId: null, activeCycleId: null }
  }
  if (active?.id) return { cycleId: active.id, activeCycleId: active.id }

  const { data: latest, error: lErr } = await supabase
    .from('ram_cycles')
    .select('id')
    .order('created_at', { ascending: false })
    .maybeSingle()
  if (lErr) {
    if (!isMissingTable(lErr, 'ram_cycles')) throw lErr
    return { cycleId: null, activeCycleId: null }
  }
  return { cycleId: latest?.id || null, activeCycleId: null }
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const cycleParam = searchParams.get('ram_cycle_id') || searchParams.get('cycle_id')
    const ordersHasCycle = await hasColumn(supabase, 'ram_orders', 'ram_cycle_id')
    const { cycleId, activeCycleId } = await resolveRamCycleId({ supabase, cycleParam, ordersHasCycle })

    // Fetch delivery locations (small reference table) via Supabase
    const { data: allLocations, error: locErr } = await supabase
      .from('ram_delivery_locations')
      .select('id,delivery_location,name,is_active')
      .order('delivery_location', { ascending: true })

    if (locErr) return NextResponse.json({ ok: false, error: 'Failed to load delivery locations' }, { status: 500 })

    // Check if interest_amount column exists (older schemas may not have it)
    const hasInterest = await hasColumn(supabase, 'ram_orders', 'interest_amount')

    // --- SQL aggregation via CTEs ------------------------------------------------
    // All heavy-lifting (GROUP BY) is done in Postgres so we don't need to
    // stream every row into JS memory.  Each CTE produces rows that the
    // route handler maps into the JSON response shape.
    const cycleFilter = ordersHasCycle && cycleId != null
    const params = cycleFilter ? [cycleId] : []
    const cycleWhere = cycleFilter
      ? "WHERE ro.ram_cycle_id = $1 AND ro.status != 'Cancelled'"
      : "WHERE ro.status != 'Cancelled'"
    const interestExpr = hasInterest ? 'ro.interest_amount' : '0'

    const sql = `
      WITH filtered_orders AS (
        SELECT
          ro.status,
          ro.payment_option,
          COALESCE(ro.member_category, 'Unknown')  AS member_category,
          COALESCE(ro.member_grade,  'Unknown')    AS member_grade,
          ro.ram_delivery_location_id,
          COALESCE(ro.qty, 0)           AS qty,
          COALESCE(ro.total_amount, 0)  AS total_amount,
          COALESCE(${interestExpr}, 0)  AS loan_interest
        FROM ram_orders ro
        ${cycleWhere}
      ),
      totals AS (
        SELECT
          COUNT(*)            AS orders,
          SUM(qty)            AS qty,
          SUM(total_amount)   AS amount,
          SUM(loan_interest)  AS loan_interest
        FROM filtered_orders
      ),
      by_status AS (
        SELECT status AS key, COUNT(*) AS orders, SUM(qty) AS qty,
               SUM(total_amount) AS amount, SUM(loan_interest) AS loan_interest
        FROM filtered_orders GROUP BY status
      ),
      by_payment AS (
        SELECT payment_option AS key, COUNT(*) AS orders, SUM(qty) AS qty,
               SUM(total_amount) AS amount, SUM(loan_interest) AS loan_interest
        FROM filtered_orders GROUP BY payment_option
      ),
      by_category AS (
        SELECT member_category AS key, COUNT(*) AS orders, SUM(qty) AS qty,
               SUM(total_amount) AS amount, SUM(loan_interest) AS loan_interest
        FROM filtered_orders GROUP BY member_category
      ),
      by_grade AS (
        SELECT member_grade AS key, COUNT(*) AS orders, SUM(qty) AS qty,
               SUM(total_amount) AS amount, SUM(loan_interest) AS loan_interest
        FROM filtered_orders GROUP BY member_grade
      ),
      by_location AS (
        SELECT
          COALESCE(ram_delivery_location_id::text, 'Unknown') AS key,
          COUNT(*)                                            AS orders,
          COUNT(*) FILTER (WHERE status = 'Pending')          AS pending_orders,
          COUNT(*) FILTER (WHERE status = 'Approved')         AS approved_orders,
          SUM(qty)            AS qty,
          SUM(total_amount)   AS amount,
          SUM(loan_interest)  AS loan_interest
        FROM filtered_orders GROUP BY ram_delivery_location_id
      )
      SELECT
        (SELECT row_to_json(t)              FROM totals t)           AS totals,
        (SELECT json_agg(row_to_json(x) ORDER BY x.orders DESC) FROM by_status x)   AS by_status,
        (SELECT json_agg(row_to_json(x) ORDER BY x.orders DESC) FROM by_payment x)  AS by_payment,
        (SELECT json_agg(row_to_json(x) ORDER BY x.orders DESC) FROM by_category x) AS by_category,
        (SELECT json_agg(row_to_json(x) ORDER BY x.orders DESC) FROM by_grade x)    AS by_grade,
        (SELECT json_agg(row_to_json(x) ORDER BY x.orders DESC) FROM by_location x) AS by_location
    `

    const { rows: [aggRow] } = await queryDirect(sql, params)

    const totals   = aggRow?.totals   || { orders: 0, qty: 0, amount: 0, loan_interest: 0 }
    const byStatus   = aggRow?.by_status   || []
    const byPayment  = aggRow?.by_payment  || []
    const byCategory = aggRow?.by_category || []
    const byGrade    = aggRow?.by_grade    || []
    const byLocation = aggRow?.by_location || []

    // Resolve location keys to human-readable names using the reference table
    const locationsById = new Map((allLocations || []).map((l) => [Number(l.id), l]))
    const locationIds = new Set()

    const resolvedByLocation = byLocation.map((row) => {
      const locId = Number(row.key)
      const loc = locationsById.get(locId)
      if (Number.isFinite(locId) && locId > 0) locationIds.add(locId)
      return {
        key: loc?.delivery_location || row.key || 'Unknown',
        orders: Number(row.orders || 0),
        pending_orders: Number(row.pending_orders || 0),
        approved_orders: Number(row.approved_orders || 0),
        qty: Number(row.qty || 0),
        amount: Number(row.amount || 0),
        loan_interest: Number(row.loan_interest || 0),
      }
    })

    resolvedByLocation.sort((a, b) => a.key.localeCompare(b.key))

    // Normalise numeric fields (pg returns COUNT/SUM as strings in json_agg)
    const normalize = (arr) => arr.map((r) => ({
      key: r.key,
      orders: Number(r.orders || 0),
      qty: Number(r.qty || 0),
      amount: Number(r.amount || 0),
      loan_interest: Number(r.loan_interest || 0),
    }))

    const usedLocations = (allLocations || []).filter((l) => locationIds.has(Number(l.id)))

    return NextResponse.json({
      ok: true,
      totals: {
        orders: Number(totals.orders || 0),
        qty: Number(totals.qty || 0),
        amount: Number(totals.amount || 0),
        loan_interest: Number(totals.loan_interest || 0),
      },
      byStatus: normalize(byStatus),
      byPayment: normalize(byPayment),
      byCategory: normalize(byCategory),
      byGrade: normalize(byGrade),
      byLocation: resolvedByLocation,
      meta: {
        active_ram_cycle_id: activeCycleId,
        used_ram_cycle_id: ordersHasCycle ? cycleId : null,
        locations: usedLocations.map((l) => ({
          id: l.id,
          delivery_location: l.delivery_location || '',
          name: l.name || '',
          is_active: !!l.is_active,
        })),
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Failed to load ram summary' }, { status: 500 })
  }
}
