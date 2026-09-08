// app/api/admin/exhibition/reports/delivery-pack/route.js
// Exhibition delivery-pack: Excel workbook with Master/Cash/Loan/Savings sheets
// for all non-cancelled orders in the active cycle, optionally filtered by branch.
//   GET /api/admin/exhibition/reports/delivery-pack?branch_id=&from=&to=
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'
import * as XLSX from 'xlsx/xlsx.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export async function GET(req) {
  try {
    const session = await validateSession(req, 'admin')
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const branchId = toInt(searchParams.get('branch_id'))
    const from = (searchParams.get('from') || '').trim()
    const to = (searchParams.get('to') || '').trim()
    const cycleIdParam = toInt(searchParams.get('cycle_id'))

    // Resolve active cycle
    let cycleId = cycleIdParam
    if (!cycleId) {
      const { data: active } = await supabase
        .from('exhibition_cycles')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .maybeSingle()
      cycleId = active?.id || null
    }

    let baseQ = supabase
      .from('exhibition_orders')
      .select('id, order_id, created_at, status, payment_option, member_id, member_name_snapshot, total_qty, total_amount, branch_id, branches:branch_id(name, code)')
      .neq('status', 'Cancelled')

    if (cycleId) baseQ = baseQ.eq('cycle_id', cycleId)
    if (Number.isFinite(branchId) && branchId > 0) baseQ = baseQ.eq('branch_id', branchId)
    if (from) baseQ = baseQ.gte('created_at', from)
    if (to) baseQ = baseQ.lte('created_at', `${to}T23:59:59`)

    // Paginate to get all orders
    const batchSize = 1000
    let start = 0
    const allOrders = []
    while (true) {
      const { data: page, error: pageErr } = await baseQ
        .order('id', { ascending: true })
        .range(start, start + batchSize - 1)
      if (pageErr) throw new Error(pageErr.message)
      if (!page || page.length === 0) break
      allOrders.push(...page)
      if (page.length < batchSize) break
      start += batchSize
    }

    // Fetch lines for all orders
    const orderIds = allOrders.map((o) => o.id)
    const { data: allLines } = orderIds.length
      ? await supabase
          .from('exhibition_order_lines')
          .select('order_id, vendor_id, product_name, sku, unit, qty, amount, vendors:vendor_id(name)')
          .in('order_id', orderIds)
          .order('id')
      : { data: [] }

    const linesByOrder = new Map()
    for (const l of allLines || []) {
      const arr = linesByOrder.get(l.order_id) || []
      arr.push(l)
      linesByOrder.set(l.order_id, arr)
    }

    // Flatten into rows
    const rows = []
    for (const o of allOrders) {
      const lines = linesByOrder.get(o.id) || []
      const branchName = o.branches?.name || ''
      const branchCode = o.branches?.code || ''
      for (const l of lines) {
        rows.push({
          OrderID: o.order_id || o.id,
          CreatedAt: o.created_at,
          Status: o.status,
          Payment: o.payment_option,
          MemberID: o.member_id,
          MemberName: o.member_name_snapshot || '',
          Branch: branchName,
          BranchCode: branchCode,
          Vendor: l.vendors?.name || '',
          Product: l.product_name || '',
          SKU: l.sku || '',
          Unit: l.unit || '',
          Qty: Number(l.qty || 0),
          Amount: Number(l.amount || 0),
          Total: Number(o.total_amount || 0),
        })
      }
    }

    const wb = XLSX.utils.book_new()
    const mk = (a) => XLSX.utils.json_to_sheet(a)
    XLSX.utils.book_append_sheet(wb, mk(rows), 'Master')
    XLSX.utils.book_append_sheet(wb, mk(rows.filter((r) => r.Payment === 'Cash')), 'Cash')
    XLSX.utils.book_append_sheet(wb, mk(rows.filter((r) => r.Payment === 'Loan')), 'Loan')
    XLSX.utils.book_append_sheet(wb, mk(rows.filter((r) => r.Payment === 'Savings')), 'Savings')

    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
    const filename = `Exhibition_Delivery_Pack_${branchId && branchId > 0 ? branchId : 'ALL'}.xlsx`

    return NextResponse.json({
      ok: true,
      filename,
      data: b64,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Internal server error' }, { status: 500 })
  }
}
