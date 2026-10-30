import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabaseServer'
import { verify } from '@/lib/signing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function hasColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1)
  return !error
}

async function getActiveCycleId(supabase) {
  const { data, error } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (error) throw new Error(error.message)
  return data?.id ?? null
}

async function deptId(supabase, name) {
  const { data } = await supabase.from('departments').select('id').eq('name', name).single()
  return data?.id || -1
}

export async function GET(req) {
  try {
    const supabase = createClient()
    const token = req.cookies.get('rep_token')?.value
    const claim = token && verify(token)
    if (!claim || claim.role !== 'rep') return NextResponse.json({ ok:false, error:'unauthorized' }, { status:401 })
    if (claim.module && claim.module !== 'food') return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    if (!Number.isFinite(Number(claim.branch_id)) || Number(claim.branch_id) <= 0) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'Pending'
    const limit = Number(searchParams.get('limit') || 50)
    const cursor = searchParams.get('cursor') // order_id
    const direction = searchParams.get('dir') || 'next' // next|prev

    // A department rep's scope is carried by the signed cookie and is NOT
    // user-selectable: they must only ever see their own department. The
    // ?dept= query is a convenience for a branch rep (whole branch by default,
    // or one department when they pick one).
    const scopedDeptId = Number(claim.department_id) > 0 ? Number(claim.department_id) : null
    const dept = scopedDeptId ? '' : (searchParams.get('dept') || '') // '' = All
    const ordersHasCycle = await hasColumn(supabase, 'orders', 'cycle_id')
    const cycleId = ordersHasCycle ? await getActiveCycleId(supabase) : null
    if (ordersHasCycle && !cycleId) {
      return NextResponse.json({ ok: false, error: 'No active cycle found' }, { status: 400 })
    }

    const selectCols = `
      order_id, created_at, posted_at, status, payment_option, total_amount,
      member_id, member_name_snapshot,
      member_branch:branch_id(code,name),
      delivery:delivery_branch_id(code,name),
      departments:department_id(name),
      order_lines(id, qty, unit_price, amount, items:item_id(sku,name,department_id))
    `
    let q = supabase
      .from('orders')
      .select(selectCols)
      .eq('delivery_branch_id', claim.branch_id)
      .eq('status', status)
      .order('order_id', { ascending: false })

    if (ordersHasCycle) q = q.eq('cycle_id', cycleId)
    if (scopedDeptId) q = q.eq('department_id', scopedDeptId)
    else if (dept) q = q.eq('department_id', (await deptId(supabase, dept)))
    if (cursor) {
      q = direction === 'next'
        ? q.lt('order_id', Number(cursor))
        : q.gt('order_id', Number(cursor))
    }

    const { data, error } = await q.limit(limit + 1)
    if (error) throw new Error(error.message)

    let nextCursor = null
    let page = data || []
    if (page.length > limit) {
      nextCursor = page[limit - 1]?.order_id
      page = page.slice(0, limit)
    }

    return NextResponse.json({ ok:true, orders: page, nextCursor, branch: claim.branch_code, department: scopedDeptId ? claim.department || '' : (dept || '') })
  } catch (e) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 })
  }
}
