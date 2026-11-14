// Exhibition uses exactly four statuses: Pending, Approved, Confirmed and
// Cancelled. There is no separate Delivered state.
export function normalizeExhibitionStatus(status) {
  return String(status || '')
}
