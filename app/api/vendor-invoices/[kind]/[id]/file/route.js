// app/api/vendor-invoices/[kind]/[id]/file/route.js
// Stable, session-guarded link to a stored vendor invoice.
//
// Pages used to hand the browser a long Supabase signed URL: a token in the
// query string that expired after an hour and turned up in history, pasted
// links and screenshots. They now link here instead — the caller's own session
// is checked and the file is re-signed at the moment it is opened, so the link
// stays short and keeps working.
import { NextResponse } from 'next/server'
import { validateSession } from '@/lib/validation'
import { createClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = {
  exhibition: {
    table: 'exhibition_vendor_invoices',
    select: 'id,vendor_id,storage_bucket,storage_path,file_name,mime_type',
  },
  food: {
    table: 'food_vendor_invoices',
    select: 'id,storage_bucket,storage_path,file_name,mime_type,branch_id',
  },
  ram: {
    table: 'ram_vendor_invoices',
    select: 'id,storage_bucket,storage_path,file_name,mime_type,ram_delivery_location_id',
  },
}

// A ram rep can cover several delivery locations; the claim may carry the list
// or the single id. Same shape the rep list routes use.
function getRepLocationIds(claims) {
  const rawIds = Array.isArray(claims?.ram_delivery_location_ids) ? claims.ram_delivery_location_ids : []
  const ids = rawIds.length ? rawIds : [claims?.ram_delivery_location_id]
  return new Set(ids.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0))
}

function redirectTo(url) {
  const res = NextResponse.redirect(url, 302)
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}

export async function GET(req, context) {
  try {
    const { kind, id } = await context.params
    const meta = KINDS[String(kind || '')]
    const invoiceId = Number(id)
    if (!meta) return NextResponse.json({ ok: false, error: 'Unknown invoice type' }, { status: 400 })
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid invoice id' }, { status: 400 })
    }

    const session = await validateSession(req)
    if (!session.valid) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const claims = session.claims || {}
    const role = String(claims.role || '')
    if (!['admin', 'rep', 'vendor'].includes(role)) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createClient()
    const { data: inv, error } = await supabase
      .from(meta.table)
      .select(meta.select)
      .eq('id', invoiceId)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!inv) return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 })

    // A rep may open only invoices inside their own scope: their branch's food
    // invoices, a RAM invoice for one of their own delivery locations, or an
    // exhibition invoice belonging to a stand in their branch — the same rule
    // the rep exhibition bank pages use (`getRepBranch` + vendors.branch_id).
    // Reps on the other module get nothing, so a colliding numeric id cannot
    // leak.
    if (role === 'rep') {
      const module = String(claims.module || '')
      let allowed = false
      if (kind === 'food') {
        const branchId = Number(claims.branch_id)
        allowed =
          (!module || module === 'food') &&
          Number.isFinite(branchId) &&
          branchId > 0 &&
          Number(inv.branch_id) === branchId
      } else if (kind === 'ram') {
        allowed =
          module === 'ram' &&
          getRepLocationIds(claims).has(Number(inv.ram_delivery_location_id))
      } else if (kind === 'exhibition') {
        const branchId = Math.trunc(Number(claims.branch_id))
        if (Number.isFinite(branchId) && branchId > 0) {
          const { data: vendor } = await supabase
            .from('exhibition_vendors')
            .select('id, branch_id')
            .eq('id', Number(inv.vendor_id))
            .maybeSingle()
          allowed = !!vendor && Number(vendor.branch_id) === branchId
        }
      }
      if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    // A vendor may open only their own exhibition payout invoices — never a
    // food/RAM invoice whose numeric id happens to collide with one of theirs.
    // The ownership check uses the row already fetched for this kind, so there
    // is no second lookup against a table that might not hold the invoice.
    if (role === 'vendor') {
      const ownVendor = Number(claims.vendor_id)
      const allowed =
        kind === 'exhibition' &&
        Number.isFinite(ownVendor) &&
        ownVendor > 0 &&
        Number(inv.vendor_id) === ownVendor
      if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const bucket = String(inv.storage_bucket || '')
    const path = String(inv.storage_path || '')
    if (!bucket || !path) return NextResponse.json({ ok: false, error: 'File missing' }, { status: 404 })

    if (bucket === 'local') return redirectTo(new URL(`/uploads/${path}`, req.url))

    const { data: signed, error: signErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 5 * 60)
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ ok: false, error: 'Could not open that file' }, { status: 500 })
    }
    return redirectTo(signed.signedUrl)
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}