// app/api/vendor/exhibition/products/bulk/route.js
// POST /api/vendor/exhibition/products/bulk   body: { ids: [...] }
//
// The single-product DELETE is fine for one row, but a vendor who imported or
// uploaded a batch by mistake needs to clear hundreds at once. This is the same
// rule as the single route — lib/exhibitionProductDelete.js, not a copy of it —
// applied to a list:
//   • only the vendor's own products
//   • only unapproved ones — an approved product may already be on a member's
//     order, so it is archived instead of deleted
//   • anything that already sits on an order line cannot be deleted at all
//     (the FK blocks it), so it is reported back instead of failing the batch.
//
// Two reads cover the whole list — one to load and classify the rows, one to
// find the products that are on an order — and the names for the report come
// from the first read instead of a third lookup.
//
// Ids are chunked so a personal list in the thousands does not blow the
// PostgREST URL length limit on the `in.(...)` filter. Every id in the request
// is processed: there is no silent cap, because "select all removable" can
// legitimately send more than any fixed number and the vendor would otherwise
// be told the batch succeeded while part of it was never looked at.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'
import { deleteBlockReason, orderLineBlockReason } from '@/lib/exhibitionProductDelete'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Large enough for any realistic stand, small enough that the work still fits
// in one request. Above it the answer is an explicit error, never a quiet
// partial delete.
const MAX_IDS = 5000
const CHUNK = 200

function numArray(input) {
  const list = Array.isArray(input) ? input : input == null ? [] : [input]
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const n = Math.trunc(Number(raw))
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function POST(req) {
  try {
    const ctx = await getVendorContext(req)
    if (!ctx) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const ids = numArray(body.ids)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'No products selected' }, { status: 400 })
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        {
          ok: false,
          error: `That is ${ids.length.toLocaleString()} products in one go; the limit is ${MAX_IDS.toLocaleString()}. Delete them in batches.`,
        },
        { status: 400 }
      )
    }

    const supabase = createClient()

    // One read: ownership, approval state and the names for the report.
    const rowsById = new Map()
    for (const slice of chunk(ids, CHUNK)) {
      const { data: rows, error } = await supabase
        .from('exhibition_products')
        .select('id, name, status, approval_status, vendor_id')
        .in('id', slice)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      for (const row of rows || []) rowsById.set(Number(row.id), row)
    }

    const skipped = []
    const candidates = []
    for (const id of ids) {
      const row = rowsById.get(id)
      if (!row) {
        skipped.push({ id, name: '', reason: deleteBlockReason(null) })
        continue
      }
      if (Number(row.vendor_id) !== Number(ctx.vendor_id)) {
        skipped.push({ id, name: row.name || '', reason: 'Not your product' })
        continue
      }
      const blocked = deleteBlockReason(row)
      if (blocked) {
        skipped.push({ id, name: row.name || '', reason: blocked })
        continue
      }
      candidates.push(id)
    }

    if (!candidates.length) {
      return NextResponse.json({ ok: true, requested: ids.length, deleted: [], skipped })
    }

    // A product on an order line is history — deleting it would break the
    // invoice. Find those first so one of them cannot fail the whole batch.
    const onOrder = new Set()
    for (const slice of chunk(candidates, CHUNK)) {
      const { data: usedLines, error: lineErr } = await supabase
        .from('exhibition_order_lines')
        .select('product_id')
        .in('product_id', slice)
      if (lineErr) return NextResponse.json({ ok: false, error: lineErr.message }, { status: 500 })
      for (const line of usedLines || []) {
        const pid = Number(line.product_id)
        if (Number.isFinite(pid)) onOrder.add(pid)
      }
    }

    const deletable = []
    for (const id of candidates) {
      if (onOrder.has(id)) {
        skipped.push({ id, name: rowsById.get(id)?.name || '', reason: orderLineBlockReason(rowsById.get(id)) })
      } else {
        deletable.push(id)
      }
    }

    const deleted = []
    for (const slice of chunk(deletable, CHUNK)) {
      const { data: removed, error: delErr } = await supabase
        .from('exhibition_products')
        .delete()
        .eq('vendor_id', ctx.vendor_id)
        .in('id', slice)
        .select('id, name')

      if (!delErr) {
        for (const row of removed || []) deleted.push(Number(row.id))
        continue
      }

      // 23503 is a foreign-key block (e.g. a price-history or payout row the
      // order-line check above does not see). Retry one by one so the rest of
      // the batch still goes.
      if (String(delErr.code || '') !== '23503') {
        return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })
      }
      for (const id of slice) {
        const { data: one, error: oneErr } = await supabase
          .from('exhibition_products')
          .delete()
          .eq('vendor_id', ctx.vendor_id)
          .eq('id', id)
          .select('id, name')
        if (oneErr) {
          skipped.push({
            id,
            name: rowsById.get(id)?.name || '',
            reason:
              String(oneErr.code || '') === '23503'
                ? orderLineBlockReason(rowsById.get(id))
                : oneErr.message,
          })
          continue
        }
        for (const row of one || []) deleted.push(Number(row.id))
      }
    }

    return NextResponse.json({
      ok: true,
      requested: ids.length,
      deleted,
      skipped,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Failed to delete products' }, { status: 500 })
  }
}
