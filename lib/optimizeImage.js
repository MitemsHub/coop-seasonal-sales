// Browser-side product image optimization.
// Decodes any browser-supported image, downscales it so the longest edge is at
// most 1200 px and encodes WebP at high quality. The original aspect ratio is
// kept — nothing is cropped — so a tall or wide photo still shows the whole
// product on the card.
export const PRODUCT_IMAGE_MAX_SIZE = 1200
export const PRODUCT_IMAGE_QUALITY = 0.9

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif']

export function isSupportedProductImage(file) {
  return !!file && ACCEPTED_TYPES.includes(String(file.type || '').toLowerCase())
}

export async function optimizeProductImage(file) {
  if (!isSupportedProductImage(file)) {
    throw new Error('Please select a JPG, PNG, WebP or AVIF image.')
  }

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This image could not be read. Try exporting it as JPG, PNG or WebP.')
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height) || 1
    const scale = Math.min(1, PRODUCT_IMAGE_MAX_SIZE / longest)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

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
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', PRODUCT_IMAGE_QUALITY))
    if (!blob) throw new Error('Could not process this image.')
    return { blob, kb: Math.round(blob.size / 1024), width, height }
  } finally {
    bitmap.close?.()
  }
}
