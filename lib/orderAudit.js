// lib/orderAudit.js
// Shared audit_log writer for staff order actions (the food pattern:
// { actor, action, order_id, detail }). Used by the food and ram modules.
// Every row is tagged with the source module so the admin audit views can
// filter the shared table per module.
//
// Best-effort by design: an audit write must never block the order mutation
// itself, so failures are swallowed (the mutation already succeeded).
export async function logOrderAudit(supabase, rows, module) {
  if (!rows || !rows.length) return
  const tagged = module ? rows.map((r) => ({ module, ...r })) : rows
  try {
    await supabase.from('audit_log').insert(tagged)
  } catch {
    // Best-effort — never fail the mutation because the audit write failed.
  }
}
