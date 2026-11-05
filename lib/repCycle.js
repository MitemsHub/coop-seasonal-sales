// lib/repCycle.js
// Which cycle a rep's food screens read.
//
// The active cycle is the normal answer. But closing the season (or letting
// another module take the single active slot) used to make every rep screen
// refuse to load — "No active cycle found" — even though the branch still had
// posted orders to deliver. So when nothing is active, fall back to the newest
// cycle this branch actually has orders in; only when neither exists do the
// screens read all-time.
export async function resolveRepCycleId(supabase, branchId) {
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

  const id = Number(branchId)
  if (!Number.isFinite(id) || id <= 0) return null

  const { data } = await supabase
    .from('orders')
    .select('cycle_id')
    .eq('delivery_branch_id', id)
    .not('cycle_id', 'is', null)
    .order('order_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.cycle_id ? Number(data.cycle_id) : null
}
