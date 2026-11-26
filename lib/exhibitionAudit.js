// lib/exhibitionAudit.js
// Best-effort audit logging for Coop Exhibition order changes, written to the
// shared audit_log table (module='exhibition') so all three modules
// (food / ram / exhibition) share one trail — the same table the admin audit
// views read. The change itself is the source of truth; the audit row is a
// convenience trail for staff (rep/admin/vendor) to see who actioned an order
// and when. If the audit table hasn't been migrated yet, logging is silently
// skipped — it must never block or fail the real change.
import { createClient } from './supabaseServer'

const MODULE = 'exhibition'

function toRow(entry) {
  const orderId = Math.trunc(Number(entry?.orderId))
  if (!Number.isFinite(orderId) || orderId <= 0) return null
  const action = String(entry?.action || '').trim()
  if (!action) return null
  const note = String(entry?.note || '').trim()
  const cycleId = Math.trunc(Number(entry?.cycleId))
  return {
    module: MODULE,
    order_id: String(orderId),
    ...(Number.isFinite(cycleId) && cycleId > 0 ? { cycle_id: cycleId } : {}),
    action,
    actor: String(entry?.actorLabel || '').trim(),
    detail: {
      ...(entry?.actorType ? { actor_type: String(entry.actorType) } : {}),
      ...(note ? { note } : {}),
      ...(entry?.detail && typeof entry.detail === 'object' && !Array.isArray(entry.detail)
        ? entry.detail
        : {}),
    },
  }
}

// One entry per order that can carry its own note and structured detail. Used
// by the repricer, where every order has different before/after numbers: this
// inserts in chunks, so a season-wide run is a couple of round trips instead of
// one insert per order.
export async function logExhibitionAuditEntries(entries, { chunkSize = 500 } = {}) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return
  const rows = list.map(toRow).filter(Boolean)
  if (!rows.length) return
  try {
    const supabase = createClient()
    const size = Math.max(1, Math.trunc(Number(chunkSize) || 500))
    for (let i = 0; i < rows.length; i += size) {
      await supabase.from('audit_log').insert(rows.slice(i, i + size))
    }
  } catch {
    // Best-effort — audit must never break the action it records.
  }
}

// The common case: one action across a set of orders, with a shared note.
export async function logExhibitionAudit(orderIds, { action, actorType, actorLabel, note = '', detail = null }) {
  if (!Array.isArray(orderIds) || !orderIds.length) return
  return logExhibitionAuditEntries(
    orderIds.map((orderId) => ({ orderId, action, actorType, actorLabel, note, detail }))
  )
}
