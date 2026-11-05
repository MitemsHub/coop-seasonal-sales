// app/api/admin/reports/branch-pack/route.js
// Branch Pack (Excel) — Master / Savings / Loan / Cash sheets.
//
// Reads the base tables directly instead of v_master_sheet: that view filters on
// get_active_cycle_id(), which is NULL once a season closes, so the workbook
// came out with no rows at all. The cycle is resolved here the same way every
// staff screen resolves it — the active cycle, else the newest cycle that
// actually holds orders — so a closed season still produces the pack the
// branch needs to distribute.
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { queryDirect } from '../../../../../lib/directDb'
import * as XLSX from 'xlsx/xlsx.mjs' // ESM namespace import

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEADERS = [
  'OrderID',
  'MemberID',
  'MemberName',
  'DeliveryBranch',
  'MemberBranch',
  'Department',
  'Payment',
  'Item',
  'Sku',
  'Price',
  'Qty',
  'Amount',
  'PostedAt',
  'CreatedAt',
  'EffectiveDate',
  'Status',
  'OriginalPrice',
  'Markup',
  'Interest',
]

const BASE_SQL = `
  SELECT
    o.order_id,
    o.created_at,
    o.posted_at,
    o.payment_option::text   AS payment_option,
    o.member_id,
    o.member_name_snapshot   AS member_name,
    o.status::text           AS status,
    o.cycle_id,
    bd.code                  AS branch_code,
    bd.name                  AS branch_name,
    bm.code                  AS member_branch_code,
    bm.name                  AS member_branch_name,
    d.name                   AS department_name,
    i.name                   AS item_name,
    i.sku,
    ol.unit_price,
    ol.qty,
    ol.amount,
    COALESCE(mu.amount, 0)   AS markup_amount,
    COALESCE(c.food_loan_interest_rate_pct, 13) AS interest_pct
  FROM orders o
  JOIN order_lines ol ON ol.order_id = o.order_id
  JOIN items i ON i.item_id = ol.item_id
  JOIN branches bd ON bd.id = o.delivery_branch_id
  LEFT JOIN branches bm ON bm.id = o.branch_id
  LEFT JOIN departments d ON d.id = o.department_id
  LEFT JOIN cycles c ON c.id = o.cycle_id
  LEFT JOIN LATERAL (
    SELECT m.amount
    FROM branch_item_markups m
    WHERE m.branch_id = o.delivery_branch_id
      AND m.item_id = ol.item_id
      AND m.cycle_id = o.cycle_id
      AND m.active
    ORDER BY m.updated_at DESC
    LIMIT 1
  ) mu ON TRUE
  WHERE o.cycle_id = $1
    AND o.status::text IN ('Posted', 'Delivered')
    /*BRANCH_FILTER*/
  ORDER BY o.order_id, i.name, ol.id
`

async function resolveReportingCycle(supabase) {
  const { data: active, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (active?.id) return Number(active.id)

  // Closed season: pack from the newest cycle that has orders.
  const { data: latest, error: latestErr } = await supabase
    .from('orders')
    .select('cycle_id')
    .not('cycle_id', 'is', null)
    .order('order_id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestErr) throw new Error(latestErr.message)
  return latest?.cycle_id ? Number(latest.cycle_id) : null
}

export async function GET(req) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const branch = (searchParams.get('branch') || '').trim() // '' => ALL DELIVERY branches
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''

    const cycleId = await resolveReportingCycle(supabase)
    if (!cycleId) throw new Error('No active cycle found')

    const params = [cycleId]
    const sql = BASE_SQL.replace('/*BRANCH_FILTER*/', branch ? 'AND bd.code = $2' : '')
    if (branch) params.push(branch)

    const { rows: raw } = await queryDirect(sql, params)

    let rows = (raw || []).map((r) => {
      const price = Number(r.unit_price || 0)
      const markup = Number(r.markup_amount || 0)
      const amount = Number(r.amount || 0)
      const payment = String(r.payment_option || '')
      const ratePct = Math.max(0, Number(r.interest_pct || 0))
      return {
        OrderID: r.order_id,
        MemberID: r.member_id,
        MemberName: r.member_name,
        DeliveryBranch: r.branch_name,
        MemberBranch: r.member_branch_name || '',
        Department: r.department_name || '',
        Payment: payment,
        Item: r.item_name,
        Sku: r.sku || '',
        Price: price,
        Qty: Number(r.qty || 0),
        Amount: amount,
        PostedAt: r.posted_at,
        CreatedAt: r.created_at,
        EffectiveDate: r.posted_at || r.created_at,
        Status: r.status,
        OriginalPrice: price - markup,
        Markup: markup,
        Interest: payment === 'Loan' ? Math.round(amount * (ratePct / 100)) : 0,
      }
    })

    // Apply date filters on the effective date (posted_at, else created_at).
    if (from) {
      const fromTs = new Date(from).getTime()
      rows = rows.filter((r) => (r.EffectiveDate ? new Date(r.EffectiveDate).getTime() : 0) >= fromTs)
    }
    if (to) {
      const toTs = new Date(`${to}T23:59:59`).getTime()
      rows = rows.filter((r) => (r.EffectiveDate ? new Date(r.EffectiveDate).getTime() : 0) <= toTs)
    }

    const wb = XLSX.utils.book_new()
    // Always emit the full header row, so an empty season still opens as a
    // usable template instead of a blank workbook.
    const mk = (a) => XLSX.utils.json_to_sheet(a, { header: HEADERS })

    XLSX.utils.book_append_sheet(wb, mk(rows), 'Master')
    XLSX.utils.book_append_sheet(
      wb,
      mk(rows.filter((r) => r.Payment === 'Savings').map((r) => ({ ...r, Interest: 0 }))),
      'Savings'
    )
    XLSX.utils.book_append_sheet(wb, mk(rows.filter((r) => r.Payment === 'Loan')), 'Loan')
    XLSX.utils.book_append_sheet(
      wb,
      mk(rows.filter((r) => r.Payment === 'Cash').map((r) => ({ ...r, Interest: 0 }))),
      'Cash'
    )

    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
    const filename = `Branch_Pack_${branch || 'ALL'}.xlsx`

    return NextResponse.json({
      ok: true,
      filename,
      data: b64,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  } catch (e) {
    console.error('branch-pack error:', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
