// lib/exhibitionAudit.js
// Best-effort audit logging for Coop Exhibition order status changes, written
// to the shared audit_log table (module='exhibition') so all three modules
// (food / ram / exhibition) share one trail — the same table the admin audit
// views read. The status update itself is the source of truth; the audit row
// is a convenience trail for staff (rep/admin/vendor) to see who actioned an
// order and when. If the audit table hasn't been migrated yet, logging is
// silently skipped — it must never block or fail the real status change.
import { createClient } from './supabaseServer'

export async function logExhibitionAudit(orderIds, { action, actorType, actorLabel, note = '' }) {
  if (!Array.isArray(orderIds) || !orderIds.length) return
  try {
    const supabase = createClient()
    await supabase.from('audit_log').insert(
      orderIds
        .map((orderId) => Math.trunc(Number(orderId)))
        .filter((orderId) => Number.isFinite(orderId) && orderId > 0)
        .map((orderId) => ({
          module: 'exhibition',
          order_id: String(orderId),
          action,
          actor: String(actorLabel || '').trim(),
          detail: {
            ...(actorType ? { actor_type: actorType } : {}),
            ...(String(note || '').trim() ? { note: String(note).trim() } : {}),
          },
        }))
    )
  } catch {
    // Best-effort — audit must never break the action it records.
  }
}
