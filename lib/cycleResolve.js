// lib/cycleResolve.js
// One place that answers "which cycle are we working in?" for the season-based
// modules (food vendor banks/invoices, reports).
//
// The active cycle is the normal answer. But closing a season — or letting
// another module hold the single active slot — used to make the invoice routes
// answer "No active cycle found" and silently stop reps from filing a second
// invoice. So when nothing is active we fall back to the newest cycle that
// actually holds orders, then to the newest cycle at all. Only an empty cycles
// table returns null.

export async function resolveFoodCycle(supabase) {
  const { data: active } = await supabase
    .from('cycles')
    .select('id,code,name')
    .eq('is_active', true)
    .maybeSingle()
  if (active?.id) return active

  const { data: latestOrder } = await supabase
    .from('orders')
    .select('cycle_id')
    .not('cycle_id', 'is', null)
    .order('order_id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestOrder?.cycle_id) {
    const { data } = await supabase
      .from('cycles')
      .select('id,code,name')
      .eq('id', latestOrder.cycle_id)
      .maybeSingle()
    if (data?.id) return data
  }

  const { data: newest } = await supabase
    .from('cycles')
    .select('id,code,name')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return newest?.id ? newest : null
}

export async function resolveFoodCycleId(supabase) {
  const cycle = await resolveFoodCycle(supabase)
  return cycle?.id ? Number(cycle.id) : null
}
