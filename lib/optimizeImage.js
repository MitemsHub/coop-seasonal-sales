// Browser-side product image optimization.
// Decodes any browser-supported image, cover-crops it to a square, downscales
// it to 900×900 and encodes WebP at high quality. Uploads therefore stay small
// regardless of the original file size, and every product card is uniform.
export const PRODUCT_IMAGE_SIZE = 900
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
    const canvas = document.createElement('canvas')
    canvas.width = PRODUCT_IMAGE_SIZE
    canvas.height = PRODUCT_IMAGE_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not prepare this image for upload.')

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE)
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', PRODUCT_IMAGE_QUALITY))
    if (!blob) throw new Error('Could not process this image.')
    return { blob, kb: Math.round(blob.size / 1024) }
  } finally {
    bitmap.close?.()
  }
}
