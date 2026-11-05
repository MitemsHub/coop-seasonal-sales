// lib/orderCycle.js
// Which cycle the order screens (rep portal, admin order lists and the admin
// dashboard) read.
//
// The active cycle is the normal answer. But closing a season — or letting
// another module take the single active slot — used to blank every order list
// and zero every figure even though the latest campaign still held orders. So
// when nothing is active, fall back to the newest cycle that has orders (for a
// rep, in their own branch); only when there is none does it return null, and
// callers then read all-time.
export async function resolveOrderCycle(supabase, branchId = null) {
  try {
    const { data: active } = await supabase
      .from('cycles')
      .select('id')
      .eq('is_active', true)
      .maybeSingle()
    if (active?.id) return Number(active.id)
  } catch {
    // No cycles table — fall through to the order-derived cycle.
  }

  let q = supabase
    .from('orders')
    .select('cycle_id')
    .not('cycle_id', 'is', null)
    .order('order_id', { ascending: false })
    .limit(1)

  const id = Number(branchId)
  if (Number.isFinite(id) && id > 0) q = q.eq('delivery_branch_id', id)

  const { data } = await q.maybeSingle()
  return data?.cycle_id ? Number(data.cycle_id) : null
}
