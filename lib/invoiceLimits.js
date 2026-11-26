// Shared invoice upload rules. The upload modals use these to shrink a photo
// and explain a refusal; the upload routes use the same numbers, so the
// picker's promise ("large photos are shrunk") is actually enforced rather
// than left to the browser's idea of a file size.

// Matches the vendor-invoices storage bucket limit.
export const INVOICE_MAX_BYTES = 10 * 1024 * 1024

// Vercel rejects request bodies over ~4.5MB before the route runs, so anything
// bigger is uploaded straight to storage with a signed URL instead.
export const DIRECT_UPLOAD_THRESHOLD = 4 * 1024 * 1024

export const INVOICE_TOO_LARGE_ERROR =
  'That file is larger than 10MB — take a smaller photo or send the PDF again.'

export const INVOICE_MIME_ERROR =
  'Attach the invoice as a PDF or a photo (JPG, PNG, WEBP or HEIC).'

// Phones label files inconsistently (HEIC photos, empty or
// application/octet-stream types from some Android pickers), so the extension
// decides and the declared type is only the fallback.
export const EXT_TO_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

export function resolveInvoiceMime(fileName, declaredType) {
  const ext = (String(fileName || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  if (EXT_TO_MIME[ext]) return EXT_TO_MIME[ext]
  const declared = String(declaredType || '').toLowerCase()
  if (!declared || declared === 'application/octet-stream') return ''
  return declared
}

export function prettyInvoiceSize(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}