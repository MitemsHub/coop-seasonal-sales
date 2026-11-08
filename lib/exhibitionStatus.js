// Member-facing exhibition views use Confirmed as the final state. Delivered is
// the legacy hand-over status and is folded into Confirmed here so member
// orders match the admin, rep and vendor portals.
export function normalizeExhibitionStatus(status) {
  return String(status || '') === 'Delivered' ? 'Confirmed' : status
}
