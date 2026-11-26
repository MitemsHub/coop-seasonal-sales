// app/api/vendor/exhibition/products/bulk/route.js
// POST /api/vendor/exhibition/products/bulk   body: { ids: [...] }
//
// The single-product DELETE is fine for one row, but a vendor who imported or
// uploaded a batch by mistake needs to clear hundreds at once. This is the same
// rule as the single route, applied to a list:
//   • only the vendor's own products
//   • only unapproved ones — an approved product may already be on a member's
//     order, so it is archived instead of deleted
//   • anything that already sits on an order line cannot be deleted at all
//     (the FK blocks it), so it is reported back instead of failing the batch.
//
// Work is chunked so a personal list in the thousands does not blow the
// PostgREST URL length limit on the `in.(...)` filter.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { getVendorContext } from '../../../_session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_IDS = 2000
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
    const ids = numArray(body.ids).slice(0, MAX_IDS)
    if (!ids.length) return NextResponse.json({ ok: false, error: 'No products selected' }, { status: 400 })

    const supabase = createClient()
    const skipped = []
    const candidates = []

    for (const slice of chunk(ids, CHUNK)) {
      const { data: rows, error } = await supabase
        .from('exhibition_products')
        .select('id, name, status, approval_status, vendor_id')
        .in('id', slice)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

      const byId = new Map((rows || []).map((r) => [Number(r.id), r]))
      for (const id of slice) {
        const row = byId.get(id)
        if (!row) {
          skipped.push({ id, name: '', reason: 'Product not found' })
          continue
        }
        if (Number(row.vendor_id) !== Number(ctx.vendor_id)) {
          skipped.push({ id, name: row.name || '', reason: 'Not your product' })
          continue
        }
        if (row.approval_status === 'approved' && row.status !== 'archived') {
          skipped.push({ id, name: row.name || '', reason: 'Approved — archive it instead' })
          continue
        }
        candidates.push(id)
      }
    }

    if (!candidates.length) {
      return NextResponse.json({ ok: true, deleted: [], skipped })
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

    const nameById = new Map()
    for (const slice of chunk(candidates, CHUNK)) {
      const { data: rows } = await supabase.from('exhibition_products').select('id, name').in('id', slice)
      for (const row of rows || []) nameById.set(Number(row.id), row.name || '')
    }

    const deletable = []
    for (const id of candidates) {
      if (onOrder.has(id)) skipped.push({ id, name: nameById.get(id) || '', reason: 'On an order — archive it instead' })
      else deletable.push(id)
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

      // 23503 is a foreign-key block (e.g. a price-history or payout row we do
      // not know about). Retry one by one so the rest of the batch still goes.
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
            name: nameById.get(id) || '',
            reason: String(oneErr.code || '') === '23503' ? 'Linked to an order — archive it instead' : oneErr.message,
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
