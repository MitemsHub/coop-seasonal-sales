// Browser-side product image optimization.
// Decodes any browser-supported image, downscales it so the longest edge is at
// most 1200 px and encodes WebP at high quality. The original aspect ratio is
// kept — nothing is cropped — so a tall or wide photo still shows the whole
// product on the card.
export const PRODUCT_IMAGE_MAX_SIZE = 1200
export const PRODUCT_IMAGE_QUALITY = 0.9

// HEIC/HEIF are what iPhones produce by default, so vendors and admins reach
// for them constantly. Safari decodes them; Chrome/Firefox do not. They are
// accepted here and converted to WebP (never stored as HEIC, which no other
// browser can display).
const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]

const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])

// Android pickers sometimes hand over an empty MIME type or
// application/octet-stream, so fall back to the extension.
const EXTENSION_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
}

function extensionOf(file) {
  const name = String(file?.name || '')
  return name.includes('.') ? name.split('.').pop().toLowerCase() : ''
}

// The type we should treat the file as, tolerating the untyped cases above.
export function productImageType(file) {
  const type = String(file?.type || '').toLowerCase()
  if (ACCEPTED_TYPES.includes(type)) return type
  if (!type || type === 'application/octet-stream') {
    return EXTENSION_TYPES[extensionOf(file)] || type
  }
  return type
}

export function isHeicImage(file) {
  if (HEIC_TYPES.has(productImageType(file))) return true
  return ['heic', 'heif'].includes(extensionOf(file))
}

export function isSupportedProductImage(file) {
  return !!file && ACCEPTED_TYPES.includes(productImageType(file))
}

// createImageBitmap is the fast path, but Safari only gained HEIC support there
// late and some builds refuse it, so fall back to an <img> decode before
// giving up. Returns a drawable source plus its natural size.
async function decodeImage(file) {
  try {
    const bitmap = await createImageBitmap(file)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    }
  } catch {
    // fall through to the <img> path
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = objectUrl
    })
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (e) {
    URL.revokeObjectURL(objectUrl)
    throw e
  }
}

export async function optimizeProductImage(file) {
  if (!isSupportedProductImage(file)) {
    throw new Error('Please select a JPG, PNG, WebP, AVIF or HEIC image.')
  }

  const heic = isHeicImage(file)

  let decoded
  try {
    decoded = await decodeImage(file)
  } catch {
    throw new Error(
      heic
        ? 'This browser cannot open HEIC photos. Upload it from an iPhone or iPad, or export the photo as JPG first.'
        : 'This image could not be read. Try exporting it as JPG, PNG or WebP.'
    )
  }

  try {
    const longest = Math.max(decoded.width, decoded.height) || 1
    const scale = Math.min(1, PRODUCT_IMAGE_MAX_SIZE / longest)
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not prepare this image for upload.')

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // White backing for transparent PNGs, then the whole photo, uncropped.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(decoded.source, 0, 0, width, height)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', PRODUCT_IMAGE_QUALITY))
    if (!blob) throw new Error('Could not process this image.')
    return { blob, kb: Math.round(blob.size / 1024), width, height }
  } finally {
    decoded.release?.()
  }
}
