// Browser-side product image optimization.
// Decodes any browser-supported image, downscales it so the longest edge is at
// most 1200 px and encodes WebP at high quality. The original aspect ratio is
// kept — nothing is cropped — so a tall or wide photo still shows the whole
// product on the card.
export const PRODUCT_IMAGE_MAX_SIZE = 1200
export const PRODUCT_IMAGE_QUALITY = 0.9

// The upload route refuses anything over 2 MB, and the browser's encoder is
// not trustworthy about how many bytes it produced: Safari's canvas WebP
// encoder has shipped builds that ignore the quality argument, and older ones
// quietly return PNG instead of WebP. A 1200 px photo then left the browser at
// 2-3 MB and the vendor saw "Image too large" on a photo they had just watched
// the page promise to optimize. Stay well under the limit and measure the
// result instead of trusting the request.
export const PRODUCT_IMAGE_MAX_BYTES = 900 * 1024

// What the server should store the file as. The encoder's output type is the
// truth; this maps it to a file extension.
export function extensionForImageMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  return 'webp'
}

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

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

// One draw + encode at the given size. A fresh canvas per attempt keeps the
// previous encode from holding memory on a phone.
async function encodeImage(source, width, height, mime, quality) {
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
  ctx.drawImage(source, 0, 0, width, height)

  const blob = await canvasToBlob(canvas, mime, quality)
  if (!blob) throw new Error('Could not process this image. Try a smaller photo.')
  return blob
}

// The size the canvas should be when its longest edge is `edge` px, keeping the
// original aspect ratio.
export function dimensionsFor(width, height, edge) {
  const longest = Math.max(width, height) || 1
  const scale = Math.min(1, edge / longest)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
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
    let edge = Math.min(PRODUCT_IMAGE_MAX_SIZE, Math.round(Math.max(decoded.width, decoded.height) || 1))
    let mime = 'image/webp'
    let quality = PRODUCT_IMAGE_QUALITY
    let best = null

    // Usually one pass. The loop only runs again when the encoder produced more
    // bytes than the route will accept, which is exactly the phone case.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { width, height } = dimensionsFor(decoded.width, decoded.height, edge)
      let blob = await encodeImage(decoded.source, width, height, mime, quality)

      // toBlob falls back to PNG without saying so when the browser cannot
      // encode the requested type. PNG of a photo is far too big, so re-encode
      // as JPEG, which every browser can write and every browser can show.
      if (mime === 'image/webp' && blob.type && blob.type !== 'image/webp') {
        mime = 'image/jpeg'
        quality = 0.85
        blob = await encodeImage(decoded.source, width, height, mime, quality)
      }

      best = { blob, width, height }
      if (blob.size <= PRODUCT_IMAGE_MAX_BYTES) break

      // Shrink by the ratio needed to reach the target, but keep the step
      // bounded so a wrong estimate cannot collapse a photo in one jump.
      const needed = Math.sqrt(PRODUCT_IMAGE_MAX_BYTES / blob.size)
      edge = Math.max(480, Math.min(edge - 80, Math.round(edge * needed)))
    }

    if (best.blob.size > 2 * 1024 * 1024) {
      throw new Error('This photo could not be compressed enough. Try a smaller one.')
    }

    return {
      blob: best.blob,
      mime: best.blob.type || mime,
      kb: Math.round(best.blob.size / 1024),
      width: best.width,
      height: best.height,
    }
  } finally {
    decoded.release?.()
  }
}
