// Shared invoice upload rules. The upload modals use these to shrink a photo
// and explain a refusal; the upload routes use the same numbers, so the
// picker's promise ("large photos are shrunk") is actually enforced rather
// than left to the browser's idea of a file size.

// Matches the vendor-invoices storage bucket limit.
export const INVOICE_MAX_BYTES = 10 * 1024 * 1024

export const INVOICE_TOO_LARGE_ERROR =
  'That file is larger than 10MB — take a smaller photo or send the PDF again.'

export function prettyInvoiceSize(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}