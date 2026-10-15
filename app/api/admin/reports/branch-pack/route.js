// app/api/admin/reports/branch-pack/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import * as XLSX from 'xlsx/xlsx.mjs' // ESM namespace import

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const branch = (searchParams.get('branch') || '').trim() // '' => ALL DELIVERY branches
    const from   = searchParams.get('from') || ''
    const to     = searchParams.get('to')   || ''

    const hasColumn = async (table, column) => {
      const { error } = await supabase.from(table).select(column).limit(1)
      return !error
    }

    const masterHasCycle = await hasColumn('v_master_sheet', 'cycle_id')
    const masterHasStatus = await hasColumn('v_master_sheet', 'status')
    const markupsHasCycle = await hasColumn('branch_item_markups', 'cycle_id')
    let effectiveCycleId = null
    if (markupsHasCycle && !masterHasCycle) {
      const { data: activeCycle, error: cycleErr } = await supabase
        .from('cycles')
        .select('id')
        .eq('is_active', true)
        .maybeSingle()
      if (cycleErr) throw new Error(cycleErr.message)
      if (!activeCycle?.id) throw new Error('No active cycle found')
      effectiveCycleId = activeCycle.id
    }

    // v_master_sheet now exposes:
    // branch_code/branch_name           => DELIVERY branch
    // member_branch_code/_name          => MEMBER (home) branch
    const selectCols = `
      order_id,
      created_at,
      posted_at,
      payment_option,
      member_id,
      member_name,
      ${masterHasStatus ? 'status,' : ''}
      ${masterHasCycle ? 'cycle_id,' : ''}
      branch_code,
      branch_name,
      member_branch_code,
      member_branch_name,
      department_name,
      item_name,
      sku,
      unit_price,
      qty,
      amount
    `

    let q = supabase.from('v_master_sheet').select(selectCols)

    // Filter by DELIVERY branch code if provided (server-side)
    if (branch) q = q.eq('branch_code', branch)

    // NOTE: Do NOT filter by posted_at server-side; it excludes Pending orders.
    // We'll filter by an effective date client-side: posted_at if present, else created_at.

    const { data, error } = await q
    if (error) throw new Error(error.message)

    // Paginate to fetch ALL rows using 1000-row pages (Supabase default cap)
    const batchSize = 1000
    let start = 0
    const allData = []
    while (true) {
      const { data: page, error: pageErr } = await q
        .order('order_id', { ascending: true })
        .range(start, start + batchSize - 1)
      if (pageErr) throw new Error(pageErr.message)
      if (!page || page.length === 0) break
      allData.push(...page)
      if (page.length < batchSize) break
      start += batchSize
    }

    let pairs = (allData || []).map((r) => ({
      raw: r,
      row: {
        OrderID: r.order_id,
        MemberID: r.member_id,
        MemberName: r.member_name,
        DeliveryBranch: r.branch_name,
        MemberBranch: r.member_branch_name || '',
        Department: r.department_name || '',
        Payment: r.payment_option,
        Item: r.item_name,
        Sku: r.sku || '',
        Price: Number(r.unit_price),
        Qty: Number(r.qty),
        Amount: Number(r.amount),
        PostedAt: r.posted_at,
        CreatedAt: r.created_at,
        EffectiveDate: r.posted_at || r.created_at,
        ...(masterHasStatus ? { Status: r.status } : {}),
      },
    }))

    if (masterHasStatus) {
      pairs = pairs.filter((p) => String(p?.row?.Status || '') !== 'Cancelled')
    } else {
      const { data: cancelledOrders, error: cancelledErr } = await supabase
        .from('orders')
        .select('order_id')
        .eq('status', 'Cancelled')
      if (cancelledErr) throw new Error(cancelledErr.message)
      const cancelledSet = new Set((cancelledOrders || []).map((o) => Number(o.order_id)).filter((n) => Number.isFinite(n) && n > 0))
      pairs = pairs.filter((p) => !cancelledSet.has(Number(p?.row?.OrderID)))
    }

    // Apply date filters client-side using EffectiveDate (posted_at || created_at)
    if (from) {
      const fromTs = new Date(from).getTime()
      pairs = pairs.filter((p) => {
        const d = p?.row?.EffectiveDate ? new Date(p.row.EffectiveDate).getTime() : 0
        return d >= fromTs
      })
    }
    if (to) {
      const toTs = new Date(to + 'T23:59:59').getTime()
      pairs = pairs.filter((p) => {
        const d = p?.row?.EffectiveDate ? new Date(p.row.EffectiveDate).getTime() : 0
        return d <= toTs
      })
    }

    const baseRows = pairs.map((p) => p.row)

    // Build enrichment maps for Markup using item names joined from markups
    const branchCodes = [...new Set((allData || []).map(r => r.branch_code))].filter(Boolean)
    const cycleIds = masterHasCycle
      ? [...new Set((allData || []).map(r => r.cycle_id).filter(v => v != null))]
      : (effectiveCycleId != null ? [effectiveCycleId] : [])

    // Fetch branches map: code -> id
    const { data: branchesData, error: branchesErr } = await supabase
      .from('branches')
      .select('id, code')
      .in('code', branchCodes)
    if (branchesErr) throw new Error(branchesErr.message)
    const branchIdByCode = new Map(branchesData.map(b => [b.code, b.id]))
    const branchIds = [...new Set((allData || []).map(r => branchIdByCode.get(r.branch_code)).filter(Boolean))]

    // Fetch markups joined with items to resolve by item name; paginate to avoid 1000-row cap
    const norm = s => String(s || '').toLowerCase().trim()
    const markupByBranchItem = new Map()
    {
      const batchSize = 1000
      let start = 0
      while (true) {
        let mq = supabase
          .from('branch_item_markups')
          .select(markupsHasCycle ? 'branch_id, cycle_id, amount, active, item_id' : 'branch_id, amount, active, item_id')
          .in('branch_id', branchIds)
        if (markupsHasCycle && cycleIds.length) mq = mq.in('cycle_id', cycleIds)
        const { data: page, error: pageErr } = await mq
          .order('branch_id', { ascending: true })
          .range(start, start + batchSize - 1)
        if (pageErr) throw new Error(pageErr.message)
        if (!page || page.length === 0) break
        for (const m of page) {
          if (!m.active) continue
          if (!m.item_id) continue
          const key = markupsHasCycle ? `${m.branch_id}:${m.cycle_id}:${m.item_id}` : `${m.branch_id}:${m.item_id}`
          markupByBranchItem.set(key, Number(m.amount) || 0)
        }
        if (page.length < batchSize) break
        start += batchSize
      }
    }

    // Identify each catalogue item by its unique (name, sku) pair so markups
    // resolve by item_id instead of item name — duplicate names exist in the
    // catalogue (same product imported across cycles), so name-based matching
    // would mix markups between distinct SKUs.
    const itemIdByNameSku = new Map()
    {
      const { data: itemsData, error: itemsErr } = await supabase.from('items').select('item_id, name, sku')
      if (!itemsErr && Array.isArray(itemsData)) {
        for (const it of itemsData) {
          const key = `${norm(it.name)}|${norm(it.sku)}`
          if (!itemIdByNameSku.has(key)) itemIdByNameSku.set(key, it.item_id)
        }
      }
    }

    let rateByCycleId = new Map()
    try {
      const uniqCycleIds = Array.from(new Set((cycleIds || []).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)))
      if (uniqCycleIds.length > 0) {
        const { data: rRows, error: rErr } = await supabase
          .from('cycles')
          .select('id,food_loan_interest_rate_pct')
          .in('id', uniqCycleIds)
        if (!rErr && Array.isArray(rRows)) {
          rateByCycleId = new Map(rRows.map((r) => [Number(r.id), Math.max(0, Number(r.food_loan_interest_rate_pct || 0))]))
        }
      }
    } catch {}

    // Enrich rows with OriginalPrice, Markup, Interest
    const rows = baseRows.map((r, idx) => {
      const raw = pairs[idx]?.raw || {}
      const code = raw.branch_code
      const cycleId = masterHasCycle ? raw.cycle_id : effectiveCycleId
      const itemName = r.Item
      const branchId = branchIdByCode.get(code)
      const itemId = itemIdByNameSku.get(`${norm(itemName)}|${norm(raw.sku)}`)
      const key2 = branchId && itemId
        ? (markupsHasCycle ? `${branchId}:${cycleId}:${itemId}` : `${branchId}:${itemId}`)
        : null
      const markup = key2 ? (markupByBranchItem.get(key2) || 0) : 0
      const basePrice = Number(r.Price) - Number(markup)
      const ratePct = rateByCycleId.size ? (rateByCycleId.get(Number(cycleId)) ?? 13) : 13
      const interest = r.Payment === 'Loan' ? Math.round(Number(r.Amount || 0) * (Math.max(0, Number(ratePct || 0)) / 100)) : 0
      return {
        ...r,
        OriginalPrice: Number(basePrice),
        Markup: Number(markup),
        Interest: Number(interest)
      }
    })

    const wb = XLSX.utils.book_new()
    const mk = a => XLSX.utils.json_to_sheet(a)

    // Sheets with enriched columns
    XLSX.utils.book_append_sheet(wb, mk(rows), 'Master')
    XLSX.utils.book_append_sheet(wb, mk(rows.filter(r => r.Payment === 'Savings').map(r => ({
      ...r,
      Interest: 0
    }))), 'Savings')
    XLSX.utils.book_append_sheet(wb, mk(rows.filter(r => r.Payment === 'Loan')), 'Loan')
    XLSX.utils.book_append_sheet(wb, mk(rows.filter(r => r.Payment === 'Cash').map(r => ({
      ...r,
      Interest: 0
    }))), 'Cash')

    // Use base64 encoding for better compatibility with fetch API
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
    const filename = `Branch_Pack_${branch || 'ALL'}.xlsx`

    // Return JSON with the base64 data
    return NextResponse.json({
      ok: true,
      filename,
      data: b64,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
  } catch (e) {
    console.error('branch-pack error:', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
