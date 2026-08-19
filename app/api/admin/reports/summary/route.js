// app/api/admin/reports/summary/route.js
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { queryDirect } from '../../../../../lib/directDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

async function resolveCycleId(supabase, searchParams, ordersHasCycle) {
  if (!ordersHasCycle) return null
  const raw = searchParams.get('cycle_id')
  if (raw != null && raw !== '') {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) throw new Error('Invalid cycle_id')
    return parsed
  }
  const { data, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.id ?? null
}

export async function GET(request) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const ordersHasCycle = await hasColumn(supabase, 'orders', 'cycle_id')
    const cycleId = await resolveCycleId(supabase, searchParams, ordersHasCycle)
    if (ordersHasCycle && !cycleId) {
      return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
    }

    const canFilterViews = ordersHasCycle && cycleId
    const [
      byBranchHasCycle,
      byBranchDeptHasCycle,
      byDeliveryMemberHasCycle,
      byCategoryHasCycle
    ] = canFilterViews
      ? await Promise.all([
          hasColumn(supabase, 'v_applications_by_branch', 'cycle_id'),
          hasColumn(supabase, 'v_applications_by_branch_department', 'cycle_id'),
          hasColumn(supabase, 'v_applications_by_delivery_branch_member_branch', 'cycle_id'),
          hasColumn(supabase, 'v_applications_by_category', 'cycle_id')
        ])
      : [false, false, false, false]

    const viewsAreCycleSafe =
      !ordersHasCycle || (byBranchHasCycle && byBranchDeptHasCycle && byDeliveryMemberHasCycle && byCategoryHasCycle)

    const hasDirect = !!process.env.SUPABASE_DB_URL

    let breakdowns = {
      byBranch: [],
      byBranchDept: [],
      byDeliveryMember: [],
      byCategory: []
    }

    if (viewsAreCycleSafe) {
      const byBranchQ = byBranchHasCycle && canFilterViews
        ? supabase.from('v_applications_by_branch').select('*').eq('cycle_id', cycleId)
        : supabase.from('v_applications_by_branch').select('*')
      const byBranchDeptQ = byBranchDeptHasCycle && canFilterViews
        ? supabase.from('v_applications_by_branch_department').select('*').eq('cycle_id', cycleId)
        : supabase.from('v_applications_by_branch_department').select('*')
      const byDeliveryMemberQ = byDeliveryMemberHasCycle && canFilterViews
        ? supabase.from('v_applications_by_delivery_branch_member_branch').select('*').eq('cycle_id', cycleId)
        : supabase.from('v_applications_by_delivery_branch_member_branch').select('*')
      const byCategoryQ = byCategoryHasCycle && canFilterViews
        ? supabase.from('v_applications_by_category').select('*').eq('cycle_id', cycleId)
        : supabase.from('v_applications_by_category').select('*')

      const [byBranch, byBranchDept, byDeliveryMember, byCat] = await Promise.all([
        byBranchQ, byBranchDeptQ, byDeliveryMemberQ, byCategoryQ
      ])

      const viewWarn = byBranch.error || byBranchDept.error || byDeliveryMember.error || byCat.error
      if (viewWarn) {
        console.warn('Reports summary: one or more views unavailable:', viewWarn.message)
      }

      breakdowns = {
        byBranch: byBranch?.data || [],
        byBranchDept: byBranchDept?.data || [],
        byDeliveryMember: byDeliveryMember?.data || [],
        byCategory: byCat?.data || []
      }
    } else {
      const { error: catSnapErr } = await supabase.from('orders').select('member_category_snapshot').limit(1)
      const ordersHasCategorySnapshot = !catSnapErr

      if (hasDirect) {
        const params = [Number(cycleId)]

        const byBranchSql = `
          SELECT
            b.name AS branch_name,
            COALESCE(SUM(CASE WHEN o.status = 'Pending'  THEN 1 ELSE 0 END), 0)::numeric AS pending,
            COALESCE(SUM(CASE WHEN o.status = 'Posted'   THEN 1 ELSE 0 END), 0)::numeric AS posted,
            COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0)::numeric AS delivered
          FROM branches b
          LEFT JOIN orders o
            ON o.branch_id = b.id
           AND o.cycle_id = $1
          GROUP BY b.id, b.name
          ORDER BY b.name;
        `

        const byBranchDeptSql = `
          SELECT
            b.name AS branch_name,
            d.name AS department_name,
            COALESCE(SUM(CASE WHEN o.status = 'Pending'  THEN 1 ELSE 0 END), 0)::numeric AS pending,
            COALESCE(SUM(CASE WHEN o.status = 'Posted'   THEN 1 ELSE 0 END), 0)::numeric AS posted,
            COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0)::numeric AS delivered
          FROM branches b
          CROSS JOIN departments d
          LEFT JOIN orders o
            ON o.branch_id = b.id
           AND o.department_id = d.id
           AND o.cycle_id = $1
          GROUP BY b.id, b.name, d.id, d.name
          HAVING COALESCE(SUM(CASE WHEN o.status IN ('Pending','Posted','Delivered') THEN 1 ELSE 0 END), 0) > 0
          ORDER BY b.name, d.name;
        `

        const byDeliveryMemberSql = `
          SELECT 
            db.name AS delivery_branch_name,
            mb.name AS branch_name,
            COALESCE(SUM(CASE WHEN o.status = 'Pending'  THEN 1 ELSE 0 END), 0)::numeric AS pending,
            COALESCE(SUM(CASE WHEN o.status = 'Posted'   THEN 1 ELSE 0 END), 0)::numeric AS posted,
            COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0)::numeric AS delivered
          FROM branches db
          CROSS JOIN branches mb
          LEFT JOIN orders o 
            ON o.delivery_branch_id = db.id
           AND o.branch_id          = mb.id
           AND o.cycle_id           = $1
          GROUP BY db.id, db.name, mb.id, mb.name
          ORDER BY db.name, mb.name;
        `

        const byCategorySql = ordersHasCategorySnapshot
          ? `
              WITH src AS (
                SELECT o.member_category_snapshot AS cat, o.status
                FROM orders o
                WHERE o.cycle_id = $1
                  AND o.member_category_snapshot IS NOT NULL
              )
              SELECT
                CASE 
                  WHEN cat = 'A' THEN 'Active'
                  WHEN cat = 'R' THEN 'Retiree'
                  WHEN cat = 'P' THEN 'Pensioner'
                  WHEN cat = 'E' THEN 'Coop Staff'
                  ELSE COALESCE(cat, 'Unknown')
                END AS category,
                COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0)::numeric AS pending,
                COALESCE(SUM(CASE WHEN status = 'Posted' THEN 1 ELSE 0 END), 0)::numeric AS posted,
                COALESCE(SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END), 0)::numeric AS delivered
              FROM src
              GROUP BY cat
              ORDER BY cat;
            `
          : `
              WITH src AS (
                SELECT m.category AS cat, o.status
                FROM orders o
                JOIN members m ON m.member_id = o.member_id
                WHERE o.cycle_id = $1
                  AND m.category IS NOT NULL
              )
              SELECT
                CASE 
                  WHEN cat = 'A' THEN 'Active'
                  WHEN cat = 'R' THEN 'Retiree'
                  WHEN cat = 'P' THEN 'Pensioner'
                  WHEN cat = 'E' THEN 'Coop Staff'
                  ELSE COALESCE(cat, 'Unknown')
                END AS category,
                COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0)::numeric AS pending,
                COALESCE(SUM(CASE WHEN status = 'Posted' THEN 1 ELSE 0 END), 0)::numeric AS posted,
                COALESCE(SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END), 0)::numeric AS delivered
              FROM src
              GROUP BY cat
              ORDER BY cat;
            `

        const [byBranch, byBranchDept, byDeliveryMember, byCategory] = await Promise.all([
          queryDirect(byBranchSql, params),
          queryDirect(byBranchDeptSql, params),
          queryDirect(byDeliveryMemberSql, params),
          queryDirect(byCategorySql, params)
        ])

        breakdowns = {
          byBranch: (byBranch?.rows || []).map(r => ({ ...r, pending: Number(r.pending || 0), posted: Number(r.posted || 0), delivered: Number(r.delivered || 0) })),
          byBranchDept: (byBranchDept?.rows || []).map(r => ({ ...r, pending: Number(r.pending || 0), posted: Number(r.posted || 0), delivered: Number(r.delivered || 0) })),
          byDeliveryMember: (byDeliveryMember?.rows || []).map(r => ({ ...r, pending: Number(r.pending || 0), posted: Number(r.posted || 0), delivered: Number(r.delivered || 0) })),
          byCategory: (byCategory?.rows || []).map(r => ({ ...r, pending: Number(r.pending || 0), posted: Number(r.posted || 0), delivered: Number(r.delivered || 0) }))
        }
      } else {
        const [{ data: branches, error: bErr }, { data: departments, error: dErr }] = await Promise.all([
          supabase.from('branches').select('id, name').order('name'),
          supabase.from('departments').select('id, name').order('name')
        ])
        if (bErr) throw new Error(bErr.message)
        if (dErr) throw new Error(dErr.message)

        let ordersQ = supabase
          .from('orders')
          .select(ordersHasCategorySnapshot
            ? 'order_id, status, branch_id, department_id, delivery_branch_id, member_category_snapshot, total_amount'
            : 'order_id, status, branch_id, department_id, delivery_branch_id, member_id, total_amount'
          )
          .in('status', ['Pending', 'Posted', 'Delivered'])
          .eq('cycle_id', cycleId)
        const { data: orders, error: oErr } = await ordersQ
        if (oErr) throw new Error(oErr.message)

        const branchNameById = new Map((branches || []).map(b => [b.id, b.name]))
        const deptNameById = new Map((departments || []).map(d => [d.id, d.name]))

        const byBranch = new Map((branches || []).map(b => [b.id, { branch_name: b.name, pending: 0, posted: 0, delivered: 0, value: 0 }]))
        const byBranchDept = new Map()
        const byDeliveryMember = new Map()
        const byCategory = new Map()

        let memberCatByMemberId = new Map()
        if (!ordersHasCategorySnapshot) {
          const memberIds = [...new Set((orders || []).map(o => o.member_id).filter(Boolean))]
          if (memberIds.length) {
            const { data: members, error: mErr } = await supabase
              .from('members')
              .select('member_id, category')
              .in('member_id', memberIds)
            if (mErr) throw new Error(mErr.message)
            memberCatByMemberId = new Map((members || []).map(m => [m.member_id, m.category]))
          }
        }

        function catLabel(cat) {
          if (cat === 'A') return 'Active'
          if (cat === 'R') return 'Retiree'
          if (cat === 'P') return 'Pensioner'
          if (cat === 'E') return 'Coop Staff'
          return cat || 'Unknown'
        }

        for (const o of (orders || [])) {
          const status = o.status
          const br = byBranch.get(o.branch_id) || { branch_name: branchNameById.get(o.branch_id) || 'Unknown', pending: 0, posted: 0, delivered: 0, value: 0 }
          if (status === 'Pending') br.pending += 1
          else if (status === 'Posted') br.posted += 1
          else if (status === 'Delivered') br.delivered += 1
          br.value += Number(o.total_amount || 0)
          byBranch.set(o.branch_id, br)

          const depKey = `${o.branch_id}:${o.department_id}`
          const bd = byBranchDept.get(depKey) || {
            branch_name: branchNameById.get(o.branch_id) || 'Unknown',
            department_name: deptNameById.get(o.department_id) || 'Unknown Department',
            pending: 0,
            posted: 0,
            delivered: 0
          }
          if (status === 'Pending') bd.pending += 1
          else if (status === 'Posted') bd.posted += 1
          else if (status === 'Delivered') bd.delivered += 1
          byBranchDept.set(depKey, bd)

          const dmKey = `${o.delivery_branch_id}:${o.branch_id}`
          const dm = byDeliveryMember.get(dmKey) || { pending: 0, posted: 0, delivered: 0 }
          if (status === 'Pending') dm.pending += 1
          else if (status === 'Posted') dm.posted += 1
          else if (status === 'Delivered') dm.delivered += 1
          byDeliveryMember.set(dmKey, dm)

          const rawCat = ordersHasCategorySnapshot ? o.member_category_snapshot : memberCatByMemberId.get(o.member_id)
          if (rawCat != null && rawCat !== '') {
            const label = catLabel(rawCat)
            const cat = byCategory.get(label) || { category: label, pending: 0, posted: 0, delivered: 0 }
            if (status === 'Pending') cat.pending += 1
            else if (status === 'Posted') cat.posted += 1
            else if (status === 'Delivered') cat.delivered += 1
            byCategory.set(label, cat)
          }
        }

        const deliveryMemberRows = []
        for (const db of (branches || [])) {
          for (const mb of (branches || [])) {
            const key = `${db.id}:${mb.id}`
            const c = byDeliveryMember.get(key) || { pending: 0, posted: 0, delivered: 0 }
            deliveryMemberRows.push({
              delivery_branch_name: db.name,
              branch_name: mb.name,
              pending: c.pending,
              posted: c.posted,
              delivered: c.delivered
            })
          }
        }

        breakdowns = {
          byBranch: Array.from(byBranch.values()).sort((a, b) => (a.branch_name || '').localeCompare(b.branch_name || '')),
          byBranchDept: Array.from(byBranchDept.values())
            .filter(r => (r.pending || 0) + (r.posted || 0) + (r.delivered || 0) > 0)
            .sort((a, b) => (a.branch_name || '').localeCompare(b.branch_name || '') || (a.department_name || '').localeCompare(b.department_name || '')),
          byDeliveryMember: deliveryMemberRows,
          byCategory: Array.from(byCategory.values()).sort((a, b) => (a.category || '').localeCompare(b.category || ''))
        }
      }
    }

    // Per-branch order value (₦) for the top/bottom performance charts — attached here
    // so every byBranch source (views, direct SQL, JS fallback) carries the same field.
    if (hasDirect && breakdowns.byBranch.length) {
      try {
        const valueSql = ordersHasCycle
          ? `SELECT b.name AS branch_name, COALESCE(SUM(CASE WHEN o.status IN ('Pending','Posted','Delivered') THEN o.total_amount ELSE 0 END),0)::numeric AS value
             FROM branches b
             LEFT JOIN orders o ON o.branch_id = b.id AND o.cycle_id = $1
             GROUP BY b.id, b.name`
          : `SELECT b.name AS branch_name, COALESCE(SUM(CASE WHEN o.status IN ('Pending','Posted','Delivered') THEN o.total_amount ELSE 0 END),0)::numeric AS value
             FROM branches b
             LEFT JOIN orders o ON o.branch_id = b.id
             GROUP BY b.id, b.name`
        const res = await queryDirect(valueSql, ordersHasCycle ? [cycleId] : [])
        const valueByName = new Map((res?.rows || []).map(r => [String(r.branch_name), Number(r.value || 0)]))
        breakdowns.byBranch = breakdowns.byBranch.map(r => ({ ...r, value: valueByName.get(String(r.branch_name)) ?? 0 }))
      } catch (err) {
        console.warn('Reports summary: per-branch value calc failed:', err?.message)
      }
    }

    let totalPostedQ = supabase.from('orders').select('order_id', { count: 'exact', head: true }).in('status', ['Posted','Delivered'])
    let totalPendingQ = supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'Pending')
    let totalDeliveredQ = supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'Delivered')
    let totalAllQ = supabase.from('orders').select('order_id', { count: 'exact', head: true })
    if (ordersHasCycle) {
      totalPostedQ = totalPostedQ.eq('cycle_id', cycleId)
      totalPendingQ = totalPendingQ.eq('cycle_id', cycleId)
      totalDeliveredQ = totalDeliveredQ.eq('cycle_id', cycleId)
      totalAllQ = totalAllQ.eq('cycle_id', cycleId)
    }

    // Amount totals across all statuses (Pending, Posted, Delivered)
    const statuses = ['Pending','Posted','Delivered']

    const [totalPosted, totalPending, totalDelivered, totalAll] = await Promise.all([
      totalPostedQ,
      totalPendingQ,
      totalDeliveredQ,
      totalAllQ
    ])

    // Totals and amounts should not fail the whole endpoint
    const totalsErr = totalPosted.error || totalPending.error || totalDelivered.error || totalAll.error
    if (totalsErr) {
      console.warn('Reports summary: totals error:', totalsErr.message)
    }
    const getTotal = (res) => Number(res?.rows?.[0]?.total || 0)

    // Helper to sum via Supabase when direct DB URL is not available
    async function sumViaSupabase(paymentOption) {
      let countQ = supabase
        .from('orders')
        .select('order_id', { count: 'exact', head: true })
        .in('status', statuses)
        .eq('payment_option', paymentOption)
      if (ordersHasCycle) countQ = countQ.eq('cycle_id', cycleId)
      const countRes = await countQ
      const totalCount = countRes?.count || 0
      const pageSize = 1000
      let sum = 0
      for (let start = 0; start < totalCount; start += pageSize) {
        const end = Math.min(start + pageSize - 1, Math.max(totalCount - 1, 0))
        let resQ = supabase
          .from('orders')
          .select('total_amount')
          .in('status', statuses)
          .eq('payment_option', paymentOption)
        if (ordersHasCycle) resQ = resQ.eq('cycle_id', cycleId)
        const res = await resQ
          .range(start, end)
        sum += (res?.data || []).reduce((s, r) => s + Number(r.total_amount || 0), 0)
      }
      return sum
    }

    async function sumAllViaSupabase() {
      let countQ = supabase
        .from('orders')
        .select('order_id', { count: 'exact', head: true })
        .in('status', statuses)
      if (ordersHasCycle) countQ = countQ.eq('cycle_id', cycleId)
      const countRes = await countQ
      const totalCount = countRes?.count || 0
      const pageSize = 1000
      let sum = 0
      for (let start = 0; start < totalCount; start += pageSize) {
        const end = Math.min(start + pageSize - 1, Math.max(totalCount - 1, 0))
        let resQ = supabase
          .from('orders')
          .select('total_amount')
          .in('status', statuses)
        if (ordersHasCycle) resQ = resQ.eq('cycle_id', cycleId)
        const res = await resQ
          .range(start, end)
        sum += (res?.data || []).reduce((s, r) => s + Number(r.total_amount || 0), 0)
      }
      return sum
    }

    // Compute amounts: prefer direct SQL, else robust Supabase fallback
    let loansOrdersTotal = 0
    let savingsTotal = 0
    let cashTotal = 0
    if (hasDirect) {
      const params = ordersHasCycle ? [cycleId] : []
      const loanSql = ordersHasCycle
        ? `SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM orders WHERE payment_option='Loan' AND status IN ('Pending','Posted','Delivered') AND cycle_id = $1`
        : `SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM orders WHERE payment_option='Loan' AND status IN ('Pending','Posted','Delivered')`
      const savingsSql = ordersHasCycle
        ? `WITH tgt AS (SELECT order_id FROM orders WHERE payment_option='Savings' AND status IN ('Pending','Posted','Delivered') AND cycle_id = $1) SELECT COALESCE(SUM(ol.amount),0)::numeric AS total FROM order_lines ol JOIN tgt t ON t.order_id = ol.order_id`
        : `WITH tgt AS (SELECT order_id FROM orders WHERE payment_option='Savings' AND status IN ('Pending','Posted','Delivered')) SELECT COALESCE(SUM(ol.amount),0)::numeric AS total FROM order_lines ol JOIN tgt t ON t.order_id = ol.order_id`
      const cashSql = ordersHasCycle
        ? `WITH tgt AS (SELECT order_id FROM orders WHERE payment_option='Cash' AND status IN ('Pending','Posted','Delivered') AND cycle_id = $1) SELECT COALESCE(SUM(ol.amount),0)::numeric AS total FROM order_lines ol JOIN tgt t ON t.order_id = ol.order_id`
        : `WITH tgt AS (SELECT order_id FROM orders WHERE payment_option='Cash' AND status IN ('Pending','Posted','Delivered')) SELECT COALESCE(SUM(ol.amount),0)::numeric AS total FROM order_lines ol JOIN tgt t ON t.order_id = ol.order_id`
      const allSql = ordersHasCycle
        ? `SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM orders WHERE status IN ('Pending','Posted','Delivered') AND cycle_id = $1`
        : `SELECT COALESCE(SUM(total_amount),0)::numeric AS total FROM orders WHERE status IN ('Pending','Posted','Delivered')`

      const [loansAmount, savingsAmount, cashAmount, allAmount] = await Promise.all([
        // Loans total uses orders.total_amount because it includes interest by definition
        queryDirect(loanSql, params),
        // Savings and Cash totals should reflect recorded line amounts to align with demand exports
        queryDirect(savingsSql, params),
        queryDirect(cashSql, params),
        queryDirect(allSql, params)
      ])
      loansOrdersTotal = getTotal(loansAmount)
      savingsTotal = getTotal(savingsAmount)
      cashTotal = getTotal(cashAmount)
    } else {
      loansOrdersTotal = await sumViaSupabase('Loan')
      // Fallback retains orders.total_amount for Savings/Cash; if exact alignment is required without direct SQL,
      // consider implementing a paged sum over order_lines by payment_option here.
      savingsTotal = await sumViaSupabase('Savings')
      cashTotal = await sumViaSupabase('Cash')
      // all total not needed for cards; compute if required with sumAllViaSupabase()
    }

    // Compute Loan principal and interest via direct SQL (per-order rounding)
    let loansPrincipal = 0
    let loansInterest = 0
    let loansTotal = 0
    try {
      const sql = `
        WITH loan_orders AS (
          SELECT o.order_id
               , o.total_amount
          FROM orders o
          WHERE o.payment_option = 'Loan'
            AND o.status IN ('Pending','Posted','Delivered')
            ${ordersHasCycle ? 'AND o.cycle_id = $1' : ''}
        ), per_order AS (
          -- Use recorded line amount to avoid unit_price/qty drift
          SELECT lo.order_id, lo.total_amount::numeric AS total, SUM(ol.amount)::numeric AS base
          FROM order_lines ol
          JOIN loan_orders lo ON lo.order_id = ol.order_id
          GROUP BY lo.order_id, lo.total_amount
        )
        SELECT 
          COALESCE(SUM(base), 0)::numeric AS loans_principal,
          COALESCE(SUM(GREATEST(total - base, 0)), 0)::numeric AS loans_interest,
          COALESCE(SUM(total), 0)::numeric AS loans_total
        FROM per_order;
      `
      const result = await queryDirect(sql, ordersHasCycle ? [cycleId] : [])
      const row = result?.rows?.[0]
      loansPrincipal = Number(row?.loans_principal || 0)
      loansInterest = Number(row?.loans_interest || 0)
      loansTotal = Number(row?.loans_total || 0)
    } catch (err) {
      console.warn('Reports summary: loan principal/interest calc failed, falling back:', err?.message)
      let ratePct = 13
      try {
        const rateRes = await supabase.from('cycles').select('food_loan_interest_rate_pct').eq('id', cycleId).maybeSingle()
        if (!rateRes.error && rateRes.data?.food_loan_interest_rate_pct != null) {
          ratePct = Math.max(0, Number(rateRes.data.food_loan_interest_rate_pct || 0))
        }
      } catch {}
      const denom = 1 + Math.max(0, Number(ratePct || 0)) / 100
      const loansAmountTotal = Number(loansOrdersTotal || 0)
      loansPrincipal = denom > 0 ? Math.round(loansAmountTotal / denom) : loansAmountTotal
      loansInterest = loansAmountTotal - loansPrincipal
      loansTotal = loansAmountTotal
    }

    // Unified total used by the Total Amount card: principal loan + savings +
    // cash. Interest has its own card and must not be double-counted in the
    // headline figure.
    const totalUnified = Number(loansPrincipal || 0) + Number(savingsTotal || 0) + Number(cashTotal || 0)

    return NextResponse.json({
      ok: true,
      totals: {
        totalPosted: (totalPosted && totalPosted.count) ?? 0,
        totalPending: (totalPending && totalPending.count) ?? 0,
        totalDelivered: (totalDelivered && totalDelivered.count) ?? 0,
        totalAll: (totalAll && totalAll.count) ?? 0
      },
      amounts: {
        // Displayed Total Amount card should match the sum of displayed components
        totalAll: totalUnified,
        // Loan Amount card reads from orders total to match Savings/Cash sourcing
        loans: loansOrdersTotal, // total including interest from orders table
        loansPrincipal,
        loansInterest,
        loansTotal,
        savings: savingsTotal,
        cash: cashTotal
      },
      byBranch: breakdowns.byBranch,
      byBranchDept: breakdowns.byBranchDept,
      byDeliveryMember: breakdowns.byDeliveryMember,
      byCategory: breakdowns.byCategory
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
