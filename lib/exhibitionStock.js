// lib/exhibitionStock.js
// Atomic stock handling for Coop Exhibition orders. exhibition_products.qty is
// a real stock count (NULL = unlimited); checkout reserves it, cancel releases
// it, restore re-reserves it. All mutations go through the RPC functions
// (exhibition_reserve_stock / exhibition_release_stock) which guard against
// overselling in a single transaction.
import { createClient } from '@/lib/supabaseServer'

// Reserve stock for a set of orders (one RPC per order so we can attribute
// failures). Returns { failed: [{ id, reason }] } for orders that could not be
// fully reserved — those must NOT be restored/kept live.
export async function reserveOrdersStock(supabase, orderIds) {
  const ids = (orderIds || []).map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0)
  if (!ids.length) return { failed: [] }

  const { data: lines, error } = await supabase
    .from('exhibition_order_lines')
    .select('order_id, product_id, qty')
    .in('order_id', ids)
  if (error) return { failed: ids.map((id) => ({ id, reason: error.message })) }

  const byOrder = new Map()
  const seen = new Set()
  for (const l of lines || []) {
    const oid = Number(l.order_id)
    seen.add(oid)
    if (!byOrder.has(oid)) byOrder.set(oid, [])
    // Counter invoices have no catalogue product — there is no stock to hold.
    const pid = Number(l.product_id)
    if (!Number.isFinite(pid) || pid <= 0) continue
    byOrder.get(oid).push({ product_id: pid, qty: Number(l.qty || 0) })
  }

  const failed = []
  for (const id of ids) {
    const items = byOrder.get(id) || []
    if (!seen.has(id)) {
      failed.push({ id, reason: 'Order has no lines' })
      continue
    }
    if (!items.length) continue
    const { error: rErr } = await supabase.rpc('exhibition_reserve_stock', { p_items: items })
    if (rErr) failed.push({ id, reason: 'Insufficient stock to restore' })
  }
  return { failed }
}

// Read-only approval-time guard: verify a set of Pending orders can still be
// fulfilled from current stock. A pending order already holds its units (qty
// was DECREMENTED at checkout), so the invariant is that each line's product
// still exists, is active, and its qty has not been driven below zero by an
// external stock correction — a naive `qty >= line qty` check would falsely
// reject the member who legitimately bought the last units (their reservation
// makes qty 0). NULL qty = unlimited. Returns { failed: [{ id, reason }] }.
export async function checkOrdersStock(supabase, orderIds) {
  const ids = (orderIds || []).map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0)
  if (!ids.length) return { failed: [] }

  const { data: lines, error } = await supabase
    .from('exhibition_order_lines')
    .select('order_id, product_id, qty')
    .in('order_id', ids)
  if (error) return { failed: ids.map((id) => ({ id, reason: error.message })) }

  const byOrder = new Map()
  const seen = new Set()
  const productIds = new Set()
  for (const l of lines || []) {
    const oid = Number(l.order_id)
    seen.add(oid)
    if (!byOrder.has(oid)) byOrder.set(oid, new Map())
    // A counter invoice line has no product and therefore no stock gate.
    const pid = Number(l.product_id)
    if (!Number.isFinite(pid) || pid <= 0) continue
    const m = byOrder.get(oid)
    m.set(pid, (m.get(pid) || 0) + Number(l.qty || 0))
    productIds.add(pid)
  }

  const { data: products, error: pErr } = productIds.size
    ? await supabase
        .from('exhibition_products')
        .select('id, qty, status')
        .in('id', [...productIds])
    : { data: [], error: null }
  if (pErr) return { failed: ids.map((id) => ({ id, reason: pErr.message })) }
  const byProduct = new Map((products || []).map((p) => [Number(p.id), p]))

  const failed = []
  for (const id of ids) {
    if (!seen.has(id)) {
      failed.push({ id, reason: 'Order has no lines' })
      continue
    }
    const need = byOrder.get(id)
    // Catalogue-free invoice: approved on its numbers, no stock to verify.
    if (!need || need.size === 0) continue
    let short = false
    for (const [pid] of need) {
      const p = byProduct.get(pid)
      // Missing or archived product → cannot fulfil the order.
      if (!p || p.status === 'archived') {
        short = true
        break
      }
      // NULL = unlimited; otherwise the reservation must still be intact
      // (qty is post-reservation, so below zero means an external correction
      // over-consumed the units this order holds).
      if (p.qty !== null && Number(p.qty) < 0) {
        short = true
        break
      }
    }
    if (short) failed.push({ id, reason: 'Insufficient stock to approve' })
  }
  return { failed }
}

// Release stock for a set of orders (one combined call — release cannot fail
// meaningfully). Used when orders are cancelled.
export async function releaseOrdersStock(supabase, orderIds) {
  const ids = (orderIds || []).map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0)
  if (!ids.length) return { ok: true }

  const { data: lines, error } = await supabase
    .from('exhibition_order_lines')
    .select('order_id, product_id, qty')
    .in('order_id', ids)
  if (error) return { ok: false, error: error.message }

  const items = (lines || [])
    .map((l) => ({ product_id: Number(l.product_id), qty: Number(l.qty || 0) }))
    .filter((l) => Number.isFinite(l.product_id) && l.product_id > 0 && l.qty > 0)
  if (!items.length) return { ok: true }

  const { error: rErr } = await supabase.rpc('exhibition_release_stock', { p_items: items })
  return rErr ? { ok: false, error: rErr.message } : { ok: true }
}
