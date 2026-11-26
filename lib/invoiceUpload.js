// Client-side preparation for invoice uploads. A phone photo of a receipt is
// several megabytes; shrinking it on the device first keeps the upload inside
// mobile data budgets and under the 10MB ceiling the server enforces.
import { INVOICE_MAX_BYTES, INVOICE_TOO_LARGE_ERROR } from './invoiceLimits'

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