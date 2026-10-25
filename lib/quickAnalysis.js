// lib/quickAnalysis.js
// Pure data shaping for the Food Report "Quick Analysis" infographic — the
// browser port of the standalone matplotlib prototype (build_infographic.py).
// No DOM/canvas here so the grouping rules are unit-testable; the drawing
// lives in lib/quickAnalysisCanvas.js.
//
// The headline metric mirrors the Excel the prototype consumed: a branch's
// Orders = its Pending + Posted + Delivered count for the cycle (the reports
// "Posted" card already folds Delivered into Posted, so this equals the
// Pending card + Posted card on the dashboard). Cancelled orders are excluded
// everywhere, matching the /api/admin/reports/summary headline totals.

const TOP_N = 10
const MID_MIN_ORDERS = 5 // mid-tier = 5+ orders but outside the top 10

function toCount(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function branchLabel(entry) {
  if (typeof entry === 'string') return entry.trim()
  return String(entry?.name || entry?.branch_name || '').trim()
}

/**
 * Build the full infographic model from the reports summary breakdown plus the
 * master branch list (so branches with zero orders still appear — the summary
 * views may omit them).
 *
 * @param {{ byBranch?: Array<object>, allBranches?: Array<object|string> }} input
 * @returns {{
 *   total: number, branchCount: number, top: Array, mid: Array, low: Array,
 *   zero: Array, topSum: number, topSharePct: number, lowSum: number,
 *   maxOrders: number
 * }}
 */
export function buildQuickAnalysisModel({ byBranch = [], allBranches = [] } = {}) {
  // Orders per branch, keyed by branch name. Rows are summed defensively in
  // case the same branch appears twice.
  const ordersByName = new Map()
  const addOrders = (name, orders) => {
    if (!name) return
    ordersByName.set(name, (ordersByName.get(name) || 0) + orders)
  }

  for (const row of byBranch || []) {
    const name = String(row?.branch_name || '').trim()
    if (!name) continue
    // Pending + Posted + Delivered = every operational (non-cancelled) order.
    const orders = toCount(row?.pending) + toCount(row?.posted) + toCount(row?.delivered)
    addOrders(name, orders)
  }

  // The master branch list fills in branches the summary omitted so the
  // "zero orders" section is complete (it drives the follow-up calls to
  // branches that haven't ordered yet).
  for (const entry of allBranches || []) {
    const name = branchLabel(entry)
    if (name && !ordersByName.has(name)) ordersByName.set(name, 0)
  }

  // Highest orders first; ties break A→Z so the layout is stable between runs.
  const rows = Array.from(ordersByName, ([branch_name, orders]) => ({ branch_name, orders }))
    .sort((a, b) => b.orders - a.orders || a.branch_name.localeCompare(b.branch_name))

  const total = rows.reduce((sum, r) => sum + r.orders, 0)

  // Top = the best 10 branches that actually ordered (never spend a top-10
  // slot on a zero-order branch when there are fewer than 10 branches).
  const ordering = rows.filter((r) => r.orders > 0)
  const top = ordering.slice(0, TOP_N)
  const topNames = new Set(top.map((r) => r.branch_name))

  // Excluding the top 10 keeps the four groups disjoint — with fewer than 10
  // ordering branches, a small branch can sit in the top list, and it must not
  // reappear under "1–4 orders" (the prototype asserted this partition).
  const mid = ordering.filter((r) => !topNames.has(r.branch_name) && r.orders >= MID_MIN_ORDERS)
  const low = rows.filter((r) => !topNames.has(r.branch_name) && r.orders >= 1 && r.orders < MID_MIN_ORDERS)
  const zero = rows.filter((r) => r.orders === 0)

  // Competition ranking for the top list: tied counts share a rank
  // (24, 16, 13, 13 → ranks 1, 2, 3, 3 and the next branch is rank 5).
  let prevOrders = null
  top.forEach((r, i) => {
    r.rank = i > 0 && r.orders === prevOrders ? top[i - 1].rank : i + 1
    prevOrders = r.orders
  })

  const topSum = top.reduce((sum, r) => sum + r.orders, 0)

  return {
    total,
    branchCount: rows.length,
    top,
    mid,
    low,
    zero,
    topSum,
    topSharePct: total > 0 ? (topSum / total) * 100 : 0,
    lowSum: low.reduce((sum, r) => sum + r.orders, 0),
    maxOrders: top.length ? top[0].orders : 0,
  }
}

export { TOP_N, MID_MIN_ORDERS }
