// Client-side preparation for invoice uploads. A phone photo of a receipt is
// several megabytes; shrinking it on the device first keeps the upload inside
// mobile data budgets and under the 10MB ceiling the server enforces.
import { createClient } from '@supabase/supabase-js'
import { DIRECT_UPLOAD_THRESHOLD, INVOICE_MAX_BYTES, INVOICE_TOO_LARGE_ERROR } from './invoiceLimits'

const DIRECT_UPLOAD_URL = '/api/vendor-invoices/direct-upload'

const MAX_DIMENSION = 1800
const JPEG_QUALITY = 0.82

export function isPdfFile(file) {
  return /pdf$/i.test(String(file?.name || '')) || file?.type === 'application/pdf'
}

function looksLikeImage(file) {
  return (
    String(file?.type || '').startsWith('image/') ||
    /\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i.test(String(file?.name || ''))
  )
}

// Canvas re-encode to JPEG. Resolves null when the browser cannot decode the
// file (HEIC in Chrome) or when re-encoding would not make it smaller — the
// caller then keeps the original, which the route accepts by extension.
function shrinkToJpeg(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    const done = (value) => {
      URL.revokeObjectURL(objectUrl)
      resolve(value)
    }
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        canvas.toBlob((blob) => {
          // Safari can ignore the requested type; only trust a real JPEG,
          // because the filename and content type we send are JPEG's.
          if (!blob || blob.type !== 'image/jpeg' || blob.size >= file.size) return done(null)
          const name = String(file.name || 'invoice').replace(/\.\w+$/, '')
          done(new File([blob], `${name}.jpg`, { type: 'image/jpeg' }))
        }, 'image/jpeg', JPEG_QUALITY)
      } catch {
        done(null)
      }
    }
    img.onerror = () => done(null)
    img.src = objectUrl
  })
}

// Returns the file to upload: photos are shrunk, PDFs pass through untouched.
// Throws the shared friendly message when even the shrunk file is too large.
export async function prepareInvoiceFile(file) {
  if (!file) throw new Error('Choose the invoice file to upload.')
  let prepared = file
  if (!isPdfFile(file) && looksLikeImage(file)) {
    prepared = (await shrinkToJpeg(file)) || file
  }
  if (prepared.size > INVOICE_MAX_BYTES) throw new Error(INVOICE_TOO_LARGE_ERROR)
  return prepared
}

async function readJson(res, label) {
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  const text = await res.text()
  throw new Error(`Non-JSON response from ${label} (${res.status}): ${text.slice(0, 300)}`)
}

function usableFields(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

async function postInvoiceForm(endpoint, fields, file) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(usableFields(fields))) fd.set(k, String(v))
  fd.set('file', file, file.name || 'invoice')
  const res = await fetch(endpoint, { method: 'POST', body: fd })
  return readJson(res, endpoint)
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson(res, url)
}

// Above the request-body cap the file goes straight to Supabase Storage with a
// signed URL; only the sign and complete metadata calls pass through a route.
async function postInvoiceDirect(module, fields, file) {
  const shared = { module, ...usableFields(fields) }
  const signed = await postJson(DIRECT_UPLOAD_URL, {
    action: 'sign',
    ...shared,
    file_name: file.name || 'invoice',
    file_type: file.type || '',
    file_size: file.size,
  })
  if (!signed?.ok) throw new Error(signed?.error || 'Could not prepare the upload')
  if (!signed.path || !signed.token) throw new Error('Could not prepare the upload')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('File storage is not configured. Please contact the administrator.')
  }
  const storage = createClient(supabaseUrl, supabaseKey)
  const uploadFile = new File([file], file.name || signed.file_name || 'invoice', {
    type: signed.mime_type || file.type || 'application/octet-stream',
  })
  const { error } = await storage.storage
    .from(signed.bucket || 'vendor-invoices')
    .uploadToSignedUrl(signed.path, signed.token, uploadFile, {
      contentType: signed.mime_type,
      upsert: false,
    })
  if (error) throw new Error(error.message || 'Could not upload the invoice file')

  const completed = await postJson(DIRECT_UPLOAD_URL, {
    action: 'complete',
    ...shared,
    path: signed.path,
    file_name: signed.file_name || file.name || 'invoice',
    mime_type: signed.mime_type,
    file_size: file.size,
  })
  if (!completed?.ok) throw new Error(completed?.error || 'Upload failed')
  return completed
}

// One upload path for every invoice screen: shrink the photo, then either post
// the form to the module's route or, when the file is too big for a request
// body, sign and upload it straight to storage.
export async function uploadInvoiceFile({ endpoint, module, fields = {}, file }) {
  if (!file) throw new Error('Choose the invoice file to upload.')
  const prepared = await prepareInvoiceFile(file)
  const json =
    prepared.size > DIRECT_UPLOAD_THRESHOLD
      ? await postInvoiceDirect(module, fields, prepared)
      : await postInvoiceForm(endpoint, fields, prepared)
  if (!json?.ok) throw new Error(json?.error || 'Upload failed')
  return json
}