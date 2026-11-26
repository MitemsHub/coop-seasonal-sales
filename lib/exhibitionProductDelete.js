// lib/exhibitionProductDelete.js
// One rule for removing a vendor's exhibition product, shared by the single
// DELETE route and the bulk one. They used to word the same decision two
// different ways, so a vendor saw "Approved — archive it instead" from a bulk
// run and "\"X\" is already approved. Archive it instead of deleting it." from
// the row menu — and the two could drift apart in behaviour as well as words.
//
// The rule itself:
//   • an approved product may already be on a member's order, so it is archived
//     rather than deleted (an already-archived one may be deleted if nothing
//     references it);
//   • a product that sits on an order line is history and cannot be deleted at
//     all — the foreign key blocks it — so the caller reports it instead.

export function deleteBlockReason(row) {
  if (!row) return 'Product not found'
  if (row.approval_status === 'approved' && row.status !== 'archived') {
    return `"${row.name || 'This product'}" is already approved. Archive it instead of deleting it.`
  }
  return ''
}

export function orderLineBlockReason(row) {
  const name = row?.name || 'This product'
  return row?.status === 'archived'
    ? `"${name}" is on past orders, so it can't be deleted. It is already archived and no longer appears in the shop.`
    : `"${name}" is on an order and can't be deleted. Archive it instead.`
}
