// Supabase Storage can resize (and re-encode) a public object on the fly: swapping
// /storage/v1/object/public/ for /storage/v1/render/image/public/ and adding
// width/quality returns a small image instead of the original. The resized bytes
// are cached at the CDN edge (cf-cache-status: HIT on repeat requests), so
// thumbnails cost a fraction of what the full photo did.
//
// Both dimensions are always sent. The transform only scales the edges it is
// given — `width=160` on a 653x914 photo comes back as 160x914, i.e. squeezed
// into a sliver — so a square bounding box plus `resize=contain` fits the photo
// inside it at its own aspect ratio, with no crop and no letterbox padding.
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

function clamp(value, min, max, fallback) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.max(min, Math.min(max, n))
}

// `width` is the bounding box in pixels: the thumbnail is at most that wide and
// at most that tall, whichever edge it runs out of first.
export function thumbUrl(url, width = 400, quality = 70) {
  const src = String(url || '').trim()
  if (!src || !src.includes(OBJECT_PATH) || src.includes(RENDER_PATH)) return src

  const [pathname, query = ''] = src.split('?')
  if (SKIP_EXT.test(pathname)) return src

  const box = clamp(width, 32, 2500, 400)
  const q = clamp(quality, 20, 90, 70)

  // Keep the storage cache-buster (?v=...) when the URL has one, so a replaced
  // image at the same path is not served from a stale edge copy.
  const bust = new URLSearchParams(query).get('v')
  // WebP keeps alpha, so logos and cut-out product shots stay transparent; a
  // 400px PNG thumbnail drops from ~360 KB to ~32 KB.
  const params = new URLSearchParams({
    width: String(box),
    height: String(box),
    resize: 'contain',
    quality: String(q),
    format: 'webp',
  })
  if (bust) params.set('v', bust)

  return `${pathname.replace(OBJECT_PATH, RENDER_PATH)}?${params.toString()}`
}
