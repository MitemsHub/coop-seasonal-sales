// app/lib/repManifest.js
// One source of truth for the rep "Posted Orders Manifest" exports.
//
// The PDF and the Excel sheet used to rebuild their rows independently (and
// both applied a second, line-level department filter on top of the server's
// order-level filter), so the two files — and the on-screen table — could end
// up telling different stories. Everything now flows through here: same rows,
// same totals, same scope line, in both formats.
//
// The department scope itself is applied SERVER-SIDE (/api/rep/orders/list),
// so these helpers only need to reflect it in the header.
export function buildManifest({ orders = [], search = '', dept = '' }) {
  const s = String(search || '').trim().toLowerCase()
  const filtered = !s
    ? orders
    : orders.filter((o) => {
        const hay = `${o.order_id} ${o.member_id} ${o.member_name_snapshot || ''}`.toLowerCase()
        return hay.includes(s)
      })

  const branchSet = new Set(filtered.map((o) => o?.delivery?.name).filter(Boolean))
  const branchLabel =
    branchSet.size === 1 ? [...branchSet][0] : branchSet.size > 1 ? 'Multiple Delivery Branches' : 'All Delivery Branches'

  const rows = filtered.flatMap((o) =>
    (o.order_lines || []).map((l) => ({
      id: o.member_id,
      order: o.order_id,
      member: o.member_name_snapshot,
      dept: o.departments?.name || '',
      pay: o.payment_option,
      item: l.items?.name,
      qty: Number(l.qty || 0),
      unitPrice: Number(l.unit_price || 0),
      amount: Number(l.amount || 0),
      remarks: '',
      signature: '',
    }))
  )

  const totalQty = rows.reduce((acc, r) => acc + r.qty, 0)
  const totalAmount = rows.reduce((acc, r) => acc + r.amount, 0)

  return {
    rows,
    totalQty,
    totalAmount,
    branchLabel,
    orderCount: filtered.length,
    // Identical wording in both files, so a reader can always tell what slice
    // of the branch they are looking at.
    scope: `Delivery Branch: ${branchLabel}${dept ? '  |  Department: ' + dept : ''}`,
  }
}
