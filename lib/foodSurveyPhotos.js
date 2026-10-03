// lib/foodSurveyPhotos.js
// Best-effort cleanup of food-survey photos that are no longer referenced by
// any entry. Called whenever entries are edited or a submission is deleted so
// the storage bucket doesn't accumulate orphaned images.
//
// URL shapes we may hold:
//   https://<proj>.supabase.co/storage/v1/object/public/food-survey/survey/<file>
//   /uploads/food-survey/<date>/<file>   (dev fallback)
import { unlink } from 'fs/promises'
import { join } from 'path'

const BUCKET = 'food-survey'

// Extracts the storage path (…/public/<bucket>/<path>) or returns null when
// the URL isn't one of ours — we never delete anything we can't identify.
function storagePathFromUrl(url) {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = String(url || '').indexOf(marker)
  if (idx === -1) return null
  const path = String(url).slice(idx + marker.length).split('?')[0]
  return path || null
}

function localPathFromUrl(url) {
  const m = /^\/uploads\/(food-survey\/.+)$/.exec(String(url || '').split('?')[0])
  return m ? m[1] : null
}

// urls: array of photo_url strings. Best-effort — never throws.
export async function removeSurveyPhotos(supabase, urls) {
  const targets = (urls || []).filter(Boolean)
  if (!targets.length) return

  const storagePaths = []
  const localPaths = []
  for (const url of targets) {
    const sp = storagePathFromUrl(url)
    if (sp) storagePaths.push(sp)
    else {
      const lp = localPathFromUrl(url)
      if (lp) localPaths.push(lp)
    }
  }

  if (storagePaths.length && supabase) {
    try {
      const { error } = await supabase.storage.from(BUCKET).remove(storagePaths)
      if (error) console.warn('Survey photo cleanup (storage):', error.message)
    } catch (e) {
      console.warn('Survey photo cleanup (storage):', e?.message)
    }
  }

  for (const rel of localPaths) {
    try {
      // Guard against traversal — resolved path must stay under public/uploads.
      const abs = join(process.cwd(), 'public', 'uploads', rel)
      if (!abs.startsWith(join(process.cwd(), 'public', 'uploads'))) continue
      await unlink(abs)
    } catch {
      // Missing file is fine.
    }
  }
}
