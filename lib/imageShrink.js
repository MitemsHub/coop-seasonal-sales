// lib/imageShrink.js
// Chat attachments. Photos go through the same optimizer as product and invoice
// uploads, so a phone photo is re-encoded to a web format and measured under
// the size cap instead of being handed over as the original file. That old
// fallback meant an undecodable HEIC or an oversized JPEG reached Storage
// unchanged.
//
// Non-images (PDF, DOCX, TXT…) and animated GIFs still pass through untouched:
// a canvas round-trip would destroy the animation.
import { isSupportedProductImage, optimizeProductImage, optimizedImageFile } from './optimizeImage'

function looksLikeImage(file) {
  const type = String(file?.type || '').toLowerCase()
  if (type.startsWith('image/')) return true
  return /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(String(file?.name || ''))
}

// Returns the File to upload. Throws a readable error when the photo cannot be
// converted (HEIC outside Safari, unsupported image type) rather than uploading
// something the reader on the other side may not be able to open.
export async function shrinkImageForUpload(file) {
  if (!file) return file
  if (!looksLikeImage(file)) return file
  if (String(file?.type || '').toLowerCase() === 'image/gif') return file
  if (!isSupportedProductImage(file)) {
    throw new Error('Please attach a JPG, PNG, WebP, AVIF or HEIC image.')
  }
  const optimized = await optimizeProductImage(file)
  return optimizedImageFile(file.name, optimized)
}
