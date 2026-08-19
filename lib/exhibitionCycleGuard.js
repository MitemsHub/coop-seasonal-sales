// lib/exhibitionCycleGuard.js
// Gate exhibition order mutations on their cycle still being active. Orders
// belonging to a closed (or missing) cycle must not be approved or restored —
// the season is over, so staff can only view/cancel them.

// Returns a Set of cycle ids that are NOT currently active.
export async function closedCycleIds(supabase, cycleIds) {
  const ids = [
    ...new Set(
      (cycleIds || [])
        .map((v) => Math.trunc(Number(v)))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ]
  if (!ids.length) return new Set()

  const { data, error } = await supabase
    .from('exhibition_cycles')
    .select('id, status')
    .in('id', ids)

  // If the cycles table is unreachable, don't hard-block here — the rest of
  // the module will fail loudly anyway and we shouldn't invent a closure.
  if (error) return new Set()

  const active = new Set((data || []).filter((c) => String(c.status) === 'active').map((c) => Number(c.id)))
  return new Set(ids.filter((id) => !active.has(id)))
}
