// Supabase Storage can resize (and re-encode) a public object on the fly: swapping
// /storage/v1/object/public/ for /storage/v1/render/image/public/ and adding
// width/quality returns a small image instead of the original. A 285 KB survey
// photo becomes ~27 KB at width=200, and the resized bytes are cached at the
// CDN edge (cf-cache-status: HIT on repeat requests), so thumbnails cost a
// fraction of what the full photo did.
//
// Stored URLs are never rewritten — only the <img src> is. Callers that need
// the real file (download, "open in new tab") keep using the original value.
//
// Everything that is not a public Supabase object URL passes through untouched
// (local /uploads paths, blob: previews, data: URLs, other hosts), so this is
// safe to wrap around any existing src.
const OBJECT_PATH = '/storage/v1/object/public/'
const RENDER_PATH = '/storage/v1/render/image/public/'

// The image service cannot decode HEIC, and resizing a GIF would drop its
// animation — leave those as the original file.
const SKIP_EXT = /\.(heic|heif|gif)$/i

export function thumbUrl(url, width = 400, quality = 70) {
  const src = String(url || '').trim()
  if (!src || !src.includes(OBJECT_PATH) || src.includes(RENDER_PATH)) return src

  const [pathname, query = ''] = src.split('?')
  if (SKIP_EXT.test(pathname)) return src

  const w = Math.max(32, Math.min(2500, Math.round(Number(width) || 400)))
  const q = Math.max(20, Math.min(90, Math.round(Number(quality) || 70)))

  // Keep the storage cache-buster (?v=...) when the URL has one, so a replaced
  // image at the same path is not served from a stale edge copy.
  const bust = new URLSearchParams(query).get('v')
  // WebP keeps alpha, so logos and cut-out product shots stay transparent; a
  // 400px PNG thumbnail drops from ~360 KB to ~32 KB.
  const params = new URLSearchParams({ width: String(w), quality: String(q), format: 'webp' })
  if (bust) params.set('v', bust)

  return `${pathname.replace(OBJECT_PATH, RENDER_PATH)}?${params.toString()}`
}
