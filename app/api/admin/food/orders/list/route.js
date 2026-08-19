import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabaseServer'

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

function applyOrderFilters({
  q,
  status,
  cycleId,
  ordersHasCycle,
  ordersHasCategorySnapshot,
  deliveryBranchId,
  payment,
  term,
  termBranchId,
  memberCategory,
  from,
  to,
}) {
  let out = q.eq('status', status)
  if (ordersHasCycle) out = out.eq('cycle_id', cycleId)
  if (deliveryBranchId) out = out.eq('delivery_branch_id', deliveryBranchId)
  if (payment) out = out.eq('payment_option', payment)
  if (ordersHasCategorySnapshot && memberCategory) out = out.eq('member_category_snapshot', memberCategory)
  if (term) {
    const termClean = term.replace(/%/g, '')
    const isInt = /^\d+$/.test(termClean)
    const termOr = [`member_id.ilike.%${termClean}%`, `member_name_snapshot.ilike.%${termClean}%`]
    if (isInt) termOr.push(`order_id.eq.${Number(termClean)}`)
    if (termBranchId) {
      termOr.push(`delivery_branch_id.eq.${Number(termBranchId)}`)
      termOr.push(`branch_id.eq.${Number(termBranchId)}`)
    }
    out = out.or(termOr.join(','))
  }
  if (from || to) {
    const dateCol = status === 'Pending' || status === 'Cancelled' ? 'created_at' : 'posted_at'
    if (from) out = out.gte(dateCol, `${from}T00:00:00`)
    if (to) out = out.lte(dateCol, `${to}T23:59:59.999`)
  }
  return out
}

async function computeSummary({
  supabase,
  status,
  cycleId,
  ordersHasCycle,
  ordersHasCategorySnapshot,
  deliveryBranchId,
  payment,
  term,
  termBranchId,
  memberCategory,
  from,
  to,
}) {
  let count = 0
  try {
    let cq = supabase.from('orders').select('order_id', { count: 'exact', head: true })
    cq = applyOrderFilters({
      q: cq,
      status,
      cycleId,
      ordersHasCycle,
      ordersHasCategorySnapshot,
      deliveryBranchId,
      payment,
      term,
      termBranchId,
      memberCategory,
      from,
      to,
    })
    const { count: c, error: cErr } = await cq
    if (!cErr) count = c || 0
  } catch {}

  let totalAmount = 0
  let cursor = null
  let guard = 0
  while (guard < 500) {
    guard += 1
    let sq = supabase.from('orders').select('order_id,total_amount').order('order_id', { ascending: false }).limit(1000)
    sq = applyOrderFilters({
      q: sq,
      status,
      cycleId,
      ordersHasCycle,
      ordersHasCategorySnapshot,
      deliveryBranchId,
      payment,
      term,
      termBranchId,
      memberCategory,
      from,
      to,
    })
    if (cursor) sq = sq.lt('order_id', Number(cursor))
    const { data, error } = await sq
    if (error) break
    const rows = data || []
    if (!rows.length) break
    for (const r of rows) totalAmount += Number(r.total_amount || 0)
    if (rows.length < 1000) break
    cursor = rows[rows.length - 1]?.order_id
    if (!cursor) break
  }

  // The strip's figures are admin-wide and independent of the page's status
  // filter: today's pending queue (orders created today still awaiting
  // approval) and delivered-this-cycle progress. Both stay within the active
  // cycle the list already scopes to.
  const countTotalFor = async ({ status: st, from: f, to: t }) => {
    let n = 0
    try {
      let cq = supabase.from('orders').select('order_id', { count: 'exact', head: true })
      cq = applyOrderFilters({
        q: cq,
        status: st,
        cycleId,
        ordersHasCycle,
        ordersHasCategorySnapshot,
        deliveryBranchId: null,
        payment: '',
        term: '',
        termBranchId: null,
        memberCategory: '',
        from: f,
        to: t,
      })
      const { count: c, error: cErr } = await cq
      if (!cErr) n = c || 0
    } catch {}
    let total = 0
    let cur = null
    let g = 0
    while (g < 500) {
      g += 1
      let sq = supabase.from('orders').select('order_id,total_amount').order('order_id', { ascending: false }).limit(1000)
      sq = applyOrderFilters({
        q: sq,
        status: st,
        cycleId,
        ordersHasCycle,
        ordersHasCategorySnapshot,
        deliveryBranchId: null,
        payment: '',
        term: '',
        termBranchId: null,
        memberCategory: '',
        from: f,
        to: t,
      })
      if (cur) sq = sq.lt('order_id', Number(cur))
      const { data, error } = await sq
      if (error) break
      const rows = data || []
      if (!rows.length) break
      for (const r of rows) total += Number(r.total_amount || 0)
      if (rows.length < 1000) break
      cur = rows[rows.length - 1]?.order_id
      if (!cur) break
    }
    return { count: n, total: Math.round(total) }
  }

  const todayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
  const todayPending = await countTotalFor({ status: 'Pending', from: todayStart })
  const deliveredCycle = await countTotalFor({ status: 'Delivered', from: '' })

  return { count, totalAmount, todayPending, deliveredCycle }
}

export async function GET(req) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'Pending'
    const branchCode = (searchParams.get('branch') || '').trim().toUpperCase()
    const payment = searchParams.get('payment') || ''
    const termRaw = searchParams.get('term') || ''
    const term = termRaw.trim()
    const memberCategoryRaw = (searchParams.get('member_category') || searchParams.get('category') || '').trim().toUpperCase()
    const allowedMemberCats = new Set(['A', 'R', 'P', 'E'])
    const memberCategory = allowedMemberCats.has(memberCategoryRaw) ? memberCategoryRaw : ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const limit = Number(searchParams.get('limit') || 50)
    const cursor = searchParams.get('cursor')
    const dir = (searchParams.get('dir') || 'next').toLowerCase()
    const ordersHasCycle = await hasColumn(supabase, 'orders', 'cycle_id')
    const ordersHasCategorySnapshot = await hasColumn(supabase, 'orders', 'member_category_snapshot').catch(() => false)
    const ordersHasCancelledAt = await hasColumn(supabase, 'orders', 'cancelled_at').catch(() => false)
    const ordersHasCancelledReason = await hasColumn(supabase, 'orders', 'cancelled_reason').catch(() => false)
    const cycleId = await resolveCycleId(supabase, searchParams, ordersHasCycle)
    if (ordersHasCycle && !cycleId) {
      return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
    }

    let deliveryBranchId = null
    if (branchCode) {
      const { data: br } = await supabase.from('branches').select('id').eq('code', branchCode).single()
      deliveryBranchId = br?.id || null
    }

    let termBranchId = null
    if (term) {
      const termUpper = term.toUpperCase()
      const { data: brByTerm } = await supabase.from('branches').select('id').eq('code', termUpper).maybeSingle()
      termBranchId = brByTerm?.id || null
    }

    const selectColsParts = [
      'order_id',
      'created_at',
      'posted_at',
      'status',
      'payment_option',
      'total_amount',
      'member_id',
      'member_name_snapshot',
      'member_category_snapshot',
      ...(ordersHasCancelledAt ? ['cancelled_at'] : []),
      ...(ordersHasCancelledReason ? ['cancelled_reason'] : []),
      'delivery:delivery_branch_id(code,name)',
      'member_branch:branch_id(code,name)',
      'departments:department_id(name)',
      'order_lines(id, qty, unit_price, amount, items:item_id(sku,name))',
    ]
    const selectCols = selectColsParts.join(',\n      ')

    let q = supabase.from('orders').select(selectCols).order('order_id', { ascending: false })
    q = applyOrderFilters({
      q,
      status,
      cycleId,
      ordersHasCycle,
      ordersHasCategorySnapshot,
      deliveryBranchId,
      payment,
      term,
      termBranchId,
      memberCategory,
      from,
      to,
    })
    if (cursor) {
      q = dir === 'next' ? q.lt('order_id', Number(cursor)) : q.gt('order_id', Number(cursor))
    }

    const { data: pageRaw, error } = await q.limit(limit + 1)
    if (error) throw new Error(error.message)

    let nextCursor = null
    let orders = pageRaw || []
    if (orders.length > limit) {
      nextCursor = orders[limit - 1]?.order_id
      orders = orders.slice(0, limit)
    }

    const summary = await computeSummary({
      supabase,
      status,
      cycleId,
      ordersHasCycle,
      ordersHasCategorySnapshot,
      deliveryBranchId,
      payment,
      term,
      termBranchId,
      memberCategory,
      from,
      to,
    })

    return NextResponse.json({ ok: true, orders, nextCursor, summary })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
