// lib/recordMemberNotification.js
// Shared client-side helper used by the status-toast watchers (food +
// exhibition). When a transition is detected it fires the toast AND records
// the event into the persistent member notifications inbox on My Coop, so the
// member can review it later. The API is idempotent (dedupe_key), so a
// re-observed transition never duplicates an entry.
//
// event is the canonical event type (posted, delivered, approved, cancelled,
// restored, ...) that the inbox groups and labels by.

export default async function recordMemberNotification({ module, memberId, orderId, event, title, message }) {
  if (!module || !memberId || !orderId || !event) return
  try {
    const res = await fetch('/api/member-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, module, event, order_id: orderId, title, message }),
    })
    const json = await res.json().catch(() => null)
    // A brand-new notification was recorded — tell any open notification bell
    // (same tab) so the badge refreshes and pulses immediately instead of
    // waiting for the next poll or tab focus.
    if (typeof window !== 'undefined' && json?.ok && !json.duplicate) {
      window.dispatchEvent(new CustomEvent('coop:member-notification', { detail: { memberId, module, orderId, event } }))
    }
  } catch {
    // Best-effort — the inbox must never break the toast or the app.
  }
}
