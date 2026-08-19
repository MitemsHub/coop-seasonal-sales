// lib/exhibitionFailed.js
// Build the per-order "failed" entries for rep bulk actions without leaking
// other-branch order statuses back to the caller. A rep who passes an id from
// another branch gets back only `{ id, reason: 'Not in your branch' }` — never
// the status of an order outside their branch. Ids that were successfully
// processed are excluded from the failed list.

// ids: requested order ids; byId: Map(id -> order row); branchId: the rep's
// branch; closed: Set of cycle ids that are no longer active (approve/restore
// only — cancel isn't cycle-gated); processed: Set of ids that succeeded.
export function buildRepFailed(ids, byId, branchId, closed = new Set(), processed = new Set()) {
  return ids
    .filter((id) => !processed.has(id))
    .map((id) => {
      const row = byId.get(id)
      if (!row) return { id, status: '' }
      if (Number(row.branch_id) !== branchId) return { id, reason: 'Not in your branch' }
      const entry = { id, status: String(row.status || '') }
      if (closed.has(Number(row.cycle_id))) entry.reason = 'Closed exhibition cycle'
      return entry
    })
}
