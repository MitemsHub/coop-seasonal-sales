// app/api/vendor-invoices/direct-upload/route.js
// The one direct-to-storage upload used by every invoice screen. Files above
// the serverless request cap are signed and uploaded from the browser, then
// this route verifies the object actually landed and records the row.
//   { action: 'sign', module, ...fields } — returns bucket/path/token
//   { action: 'complete', module, path, ...fields } — records the invoice
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabaseServer'
import { INVOICE_BUCKET, invoiceFileLink } from '@/lib/invoiceStorage'
import { INVOICE_MAX_BYTES, INVOICE_MIME_ERROR, INVOICE_TOO_LARGE_ERROR, resolveInvoiceMime } from '@/lib/invoiceLimits'
import {
  authenticateInvoiceActor,
  buildInvoiceRow,
  resolveInvoiceTarget,
  safeName,
} from '@/lib/invoiceDirectUpload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ensureBucket(supabase) {
  try {
    const { data } = await supabase.storage.getBucket(INVOICE_BUCKET)
    if (!data) await supabase.storage.createBucket(INVOICE_BUCKET, { public: false })
  } catch {
    // Let the sign call report the real storage error.
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const module = String(body?.module || '').trim()
    const supabase = createClient()

    const actor = await authenticateInvoiceActor(req, module)
    if (actor.error) return NextResponse.json({ ok: false, error: actor.error }, { status: actor.status })

    const target = await resolveInvoiceTarget(supabase, module, actor, body)
    if (target.error) return NextResponse.json({ ok: false, error: target.error }, { status: target.status })

    const action = String(body?.action || '').trim()

    if (action === 'sign') {
      const fileName = safeName(body?.file_name)
      const mime = resolveInvoiceMime(fileName, body?.file_type)
      if (!target.allowedMime.has(mime)) {
        return NextResponse.json({ ok: false, error: INVOICE_MIME_ERROR }, { status: 400 })
      }

      const fileSize = Number(body?.file_size || 0)
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > INVOICE_MAX_BYTES) {
        return NextResponse.json({ ok: false, error: INVOICE_TOO_LARGE_ERROR }, { status: 400 })
      }

      await ensureBucket(supabase)
      const now = new Date()
      const day = now.toISOString().slice(0, 10)
      const rand = Math.random().toString(16).slice(2, 10)
      const path = `${target.pathPrefix}/${day}/${Date.now()}_${rand}_${fileName}`
      const { data: signed, error } = await supabase.storage
        .from(INVOICE_BUCKET)
        .createSignedUploadUrl(path, { upsert: false })
      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message || 'Could not prepare the upload' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        ok: true,
        action: 'sign',
        bucket: INVOICE_BUCKET,
        path: signed?.path || path,
        token: signed?.token,
        signed_url: signed?.signedUrl || null,
        file_name: fileName,
        mime_type: mime,
        file_size: fileSize,
      })
    }

    if (action === 'complete') {
      const path = String(body?.path || '')
      const prefix = `${target.pathPrefix}/`
      if (!path.startsWith(prefix) || path.includes('..') || path.includes('\\')) {
        return NextResponse.json({ ok: false, error: 'Invalid upload path' }, { status: 400 })
      }

      const slash = path.lastIndexOf('/')
      const dir = slash >= 0 ? path.slice(0, slash) : ''
      const storedName = slash >= 0 ? path.slice(slash + 1) : ''
      if (!dir || !storedName) {
        return NextResponse.json({ ok: false, error: 'Invalid upload path' }, { status: 400 })
      }

      const fileName = safeName(body?.file_name || storedName)
      const mime = resolveInvoiceMime(storedName, body?.mime_type)
      if (!target.allowedMime.has(mime)) {
        return NextResponse.json({ ok: false, error: INVOICE_MIME_ERROR }, { status: 400 })
      }

      // Confirm the browser really finished the PUT before recording a row, so
      // a dropped connection cannot leave a broken invoice on the list.
      const { data: listed, error: listErr } = await supabase.storage
        .from(INVOICE_BUCKET)
        .list(dir, { search: storedName, limit: 1 })
      if (listErr) {
        return NextResponse.json(
          { ok: false, error: listErr.message || 'Could not verify the uploaded file' },
          { status: 500 }
        )
      }
      const object = Array.isArray(listed) ? listed.find((f) => f.name === storedName) : null
      if (!object) {
        return NextResponse.json(
          { ok: false, error: 'The file did not finish uploading. Please try again.' },
          { status: 400 }
        )
      }

      const reportedSize = Number(body?.file_size || 0)
      const actualSize = Number(object?.metadata?.size ?? reportedSize)
      const fileSize = Number.isFinite(actualSize) && actualSize > 0 ? actualSize : reportedSize
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > INVOICE_MAX_BYTES) {
        await supabase.storage.from(INVOICE_BUCKET).remove([path])
        return NextResponse.json({ ok: false, error: INVOICE_TOO_LARGE_ERROR }, { status: 400 })
      }

      const row = buildInvoiceRow(target, { path, fileName, mime, fileSize, body })
      const { data: inserted, error: insErr } = await supabase
        .from(target.table)
        .insert(row)
        .select(target.select)
        .single()
      if (insErr) {
        await supabase.storage.from(INVOICE_BUCKET).remove([path])
        return NextResponse.json(
          { ok: false, error: `Could not save the invoice: ${insErr.message}` },
          { status: 500 }
        )
      }

      return NextResponse.json({
        ok: true,
        action: 'complete',
        invoice: { ...inserted, url: invoiceFileLink(target.urlKind, inserted) },
      })
    }

    return NextResponse.json({ ok: false, error: 'Unknown upload action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal server error' }, { status: 500 })
  }
}