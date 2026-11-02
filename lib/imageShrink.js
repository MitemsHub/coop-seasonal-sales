// lib/imageShrink.js
// Browser-side downscale used before uploading picked images (chat attachments).
// Chat is the only upload path that still stored whatever the phone produced —
// a 5MB original per message. Shrinking here keeps Supabase Storage small
// without adding a server-side image dependency.
//
// Mirrors the proven pattern in FoodSurveyForm.compressImage:
//   - never upscales, never enlarges the file,
//   - returns the original file unchanged when the browser can't decode it
//     (HEIC outside Safari), when the result isn't smaller, or on any error.
const DEFAULT_MAX_DIM = 1280
const DEFAULT_QUALITY = 0.82

// Animated GIFs would lose their animation through a canvas round-trip, and
// non-images (PDF, DOCX, TXT) must pass through untouched.
function shouldShrink(file, maxDim) {
  if (!file?.type?.startsWith('image/')) return false
  if (file.type === 'image/gif') return false
  return true
}

export function shrinkImageForUpload(file, maxDim = DEFAULT_MAX_DIM, quality = DEFAULT_QUALITY) {
  return new Promise((resolve) => {
    if (!shouldShrink(file, maxDim)) return resolve(file)
    // Already small enough — a canvas round-trip would only add work.
    if (file.size <= 300 * 1024) return resolve(file)

    let objectUrl = null
    const done = (value) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      resolve(value)
    }

    try {
      const img = new Image()
      objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
          const w = Math.max(1, Math.round(img.width * scale))
          const h = Math.max(1, Math.round(img.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          canvas.getContext('2d').drawImage(img, 0, 0, w, h)
          canvas.toBlob((blob) => {
            if (!blob || blob.size >= file.size) return done(file)
            const name = (file.name || 'image').replace(/\.\w+$/, '')
            done(new File([blob], `${name}.jpg`, { type: 'image/jpeg' }))
          }, 'image/jpeg', quality)
        } catch {
          done(file)
        }
      }
      img.onerror = () => done(file)
      img.src = objectUrl
    } catch {
      done(file)
    }
  })
}
